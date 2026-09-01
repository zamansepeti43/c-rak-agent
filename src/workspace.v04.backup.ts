import fs from "node:fs/promises";
import path from "node:path";

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vite",
  "coverage",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode"
]);

export type RelevantFile = {
  file: string;
  score: number;
  evidence: string[];
};

export async function listFiles(
  root: string,
  max = 500
): Promise<string[]> {
  const result: string[] = [];

  async function walk(dir: string) {
    if (result.length >= max) return;

    const entries = await fs.readdir(dir, {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (result.length >= max) return;
      if (IGNORE.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else {
        result.push(
          path.relative(root, full).replaceAll("\\", "/")
        );
      }
    }
  }

  await walk(root);

  return result.sort();
}

export async function readFile(
  root: string,
  relativePath: string,
  maxChars = 30000
): Promise<string> {
  const full = path.resolve(root, relativePath);
  const rootResolved = path.resolve(root);

  if (
    !full.startsWith(rootResolved + path.sep)
  ) {
    throw new Error(
      "Workspace dışına erişim reddedildi."
    );
  }

  const text = await fs.readFile(full, "utf8");

  return text.length > maxChars
    ? text.slice(0, maxChars) +
        "\n\n[Dosya kısaltıldı]"
    : text;
}

export async function searchFiles(
  root: string,
  query: string,
  files: string[],
  maxResults = 40
): Promise<
  Array<{
    file: string;
    line: number;
    text: string;
  }>
> {
  const results: Array<{
    file: string;
    line: number;
    text: string;
  }> = [];

  const needle = query
    .trim()
    .toLocaleLowerCase("tr-TR");

  if (!needle) return results;

  for (const file of files) {
    if (results.length >= maxResults) break;

    const ext = path
      .extname(file)
      .toLowerCase();

    if (
      ![
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".css",
        ".json",
        ".md"
      ].includes(ext)
    ) {
      continue;
    }

    try {
      const text = await readFile(
        root,
        file,
        100000
      );

      const lines = text.split(/\r?\n/);

      lines.forEach((line, i) => {
        if (
          results.length < maxResults &&
          line
            .toLocaleLowerCase("tr-TR")
            .includes(needle)
        ) {
          results.push({
            file,
            line: i + 1,
            text: line.trim().slice(0, 240)
          });
        }
      });
    } catch {
      // okunamayan dosya atlanır
    }
  }

  return results;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

function taskTerms(task: string): string[] {
  return normalize(task)
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/\s+/)
    .filter(x => x.length >= 3);
}

export async function pickRelevantFiles(
  root: string,
  files: string[],
  task: string,
  maxFiles = 12
): Promise<RelevantFile[]> {
  const normalizedTask = normalize(task);

  const results: RelevantFile[] = [];

  /*
   * 1. Önce TAM GÖREV ifadesini ara.
   *
   * Örneğin:
   * "Sesli Hayvan Bulma"
   *
   * varsa bu ifade dosyanın içinde gerçekten
   * geçiyorsa çok yüksek öncelik alır.
   */
  const exactMatches = await searchFiles(
    root,
    task,
    files,
    30
  );

  const exactByFile = new Map<
    string,
    string[]
  >();

  for (const match of exactMatches) {
    const list =
      exactByFile.get(match.file) ?? [];

    list.push(
      `Tam görev ifadesi bulundu: "${task}" (satır ${match.line})`
    );

    exactByFile.set(match.file, list);
  }

  /*
   * 2. Dosya adı + içerik puanlaması.
   */
  const terms = taskTerms(task);

  for (const file of files) {
    let score = 0;
    const evidence: string[] = [];

    const normalizedFile = normalize(file);

    /*
     * Tam görev eşleşmesi en güçlü kanıt.
     */
    if (exactByFile.has(file)) {
      score += 1000;

      evidence.push(
        ...(exactByFile.get(file) ?? [])
      );
    }

    /*
     * Dosya adı eşleşmeleri.
     */
    for (const term of terms) {
      if (normalizedFile.includes(term)) {
        score += 5;
        evidence.push(
          `Dosya yolunda "${term}" bulundu`
        );
      }
    }

    /*
     * Kaynak kodu oku ve gerçek içerik üzerinden
     * ilişkileri tespit et.
     */
    if (
      score > 0 ||
      file.startsWith("src/")
    ) {
      try {
        const text = await readFile(
          root,
          file,
          60000
        );

        const normalizedText =
          normalize(text);

        for (const term of terms) {
          if (
            normalizedText.includes(term)
          ) {
            score += 8;

            if (
              evidence.length < 10
            ) {
              evidence.push(
                `İçerikte "${term}" bulundu`
              );
            }
          }
        }

        /*
         * Interaction ID'leri özellikle önemli.
         */
        const interactionIds =
          text.match(
            /(?:interactionId|interaction-id|interaction)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi
          ) ?? [];

        for (const match of interactionIds.slice(
          0,
          8
        )) {
          score += 4;
          evidence.push(
            `Interaction ID bulundu: ${match}`
          );
        }

        /*
         * animal-finder gibi doğrudan referanslar.
         */
        if (
          normalizedText.includes(
            "animal-finder"
          )
        ) {
          score += 10;
          evidence.push(
            'İçerikte "animal-finder" bulundu'
          );
        }

        /*
         * AnimalFinderGame / audio ilişkisi.
         */
        if (
          normalizedText.includes(
            "animalfindergame"
          )
        ) {
          score += 15;
          evidence.push(
            "AnimalFinderGame referansı bulundu"
          );
        }

        if (
          normalizedText.includes(
            "playrealsound"
          )
        ) {
          score += 10;
          evidence.push(
            "playRealSound kullanımı bulundu"
          );
        }

        if (
          normalizedText.includes(
            "sounds/animals"
          )
        ) {
          score += 12;
          evidence.push(
            "animals ses klasörü referansı bulundu"
          );
        }
      } catch {
        // okunamayan dosya
      }
    }

    if (score > 0) {
      results.push({
        file,
        score,
        evidence: Array.from(
          new Set(evidence)
        ).slice(0, 10)
      });
    }
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.file.localeCompare(b.file)
    )
    .slice(0, maxFiles);
}