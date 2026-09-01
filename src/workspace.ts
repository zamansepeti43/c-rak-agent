import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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

function resolveSafePath(
  root: string,
  relativePath: string
): string {
  const rootResolved = path.resolve(root);
  const full = path.resolve(root, relativePath);

  if (
    full !== rootResolved &&
    !full.startsWith(rootResolved + path.sep)
  ) {
    throw new Error(
      "Workspace dışına erişim reddedildi."
    );
  }

  return full;
}

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
  const full = resolveSafePath(root, relativePath);

  const text = await fs.readFile(full, "utf8");

  return text.length > maxChars
    ? text.slice(0, maxChars) +
        "\n\n[Dosya kısaltıldı]"
    : text;
}

/**
 * Dosyaya güvenli şekilde yazar.
 * Klasör mevcut değilse oluşturur.
 */
export async function writeFile(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const full = resolveSafePath(root, relativePath);

  await fs.mkdir(path.dirname(full), {
    recursive: true
  });

  await fs.writeFile(
    full,
    content,
    "utf8"
  );
}

/**
 * Yeni dosya oluşturur.
 * Var olan dosyanın üzerine yazmaz.
 */
export async function createFile(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const full = resolveSafePath(root, relativePath);

  await fs.mkdir(path.dirname(full), {
    recursive: true
  });

  try {
    await fs.access(full);
    throw new Error(
      `Dosya zaten mevcut: ${relativePath}`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Dosya zaten mevcut")
    ) {
      throw error;
    }
  }

  await fs.writeFile(
    full,
    content,
    "utf8"
  );
}

/**
 * Dosya siler.
 */
export async function deleteFile(
  root: string,
  relativePath: string
): Promise<void> {
  const full = resolveSafePath(root, relativePath);

  await fs.unlink(full);
}

/**
 * Kontrollü terminal komutu çalıştırır.
 */
export async function runCommand(
  root: string,
  command: string,
  timeoutMs = 120000
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const dangerousPatterns = [
    /rm\s+-rf\s+[\/\\]/i,
    /rmdir\s+\/s\s+\/q\s+[a-z]:\\?/i,
    /del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\?/i,
    /format\s+[a-z]:/i,
    /diskpart/i,
    /shutdown/i,
    /restart-computer/i,
    /remove-item\s+.*-recurse/i
  ];

  if (
    dangerousPatterns.some((pattern) =>
      pattern.test(command)
    )
  ) {
    throw new Error(
      "Güvenlik nedeniyle tehlikeli komut engellendi."
    );
  }

  try {
    const result = await execAsync(command, {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0
    };
  } catch (error: any) {
    return {
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? error?.message ?? "",
      code:
        typeof error?.code === "number"
          ? error.code
          : 1
    };
  }
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
    .filter((x) => x.length >= 3);
}

export async function pickRelevantFiles(
  root: string,
  files: string[],
  task: string,
  maxFiles = 12
): Promise<RelevantFile[]> {
  const results: RelevantFile[] = [];

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

  const terms = taskTerms(task);

  for (const file of files) {
    let score = 0;
    const evidence: string[] = [];

    const normalizedFile = normalize(file);

    if (exactByFile.has(file)) {
      score += 1000;

      evidence.push(
        ...(exactByFile.get(file) ?? [])
      );
    }

    for (const term of terms) {
      if (normalizedFile.includes(term)) {
        score += 5;
        evidence.push(
          `Dosya yolunda "${term}" bulundu`
        );
      }
    }

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

            if (evidence.length < 10) {
              evidence.push(
                `İçerikte "${term}" bulundu`
              );
            }
          }
        }

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