import readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";

import {
  listFiles,
  readFile,
  searchFiles,
  pickRelevantFiles,
} from "./workspace.js";

import {
  askOllama,
  checkOllama,
  MODEL,
} from "./ollama.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const workspace =
  process.env.CIRAK_WORKSPACE ??
  path.resolve(
    process.cwd(),
    "..",
    "cocugumla-buyuyorum-app"
  );

console.log(`
╔══════════════════════════════════════╗
║       ÇIRAK CODE AGENT v0.4          ║
╚══════════════════════════════════════╝
Model     : ${MODEL}
Workspace : ${workspace}
`);

if (!(await checkOllama())) {
  console.error(
    "\nOllama bağlantısı yok. Ayrı terminalde 'ollama serve' çalıştır."
  );
  process.exit(1);
}

console.log("Ollama    : OK");
console.log(
  "\nKomutlar: analyze <görev> | files | exit\n"
);

function isAnimalFinderTask(task: string): boolean {
  const normalized = task
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");

  return (
    normalized.includes("sesli hayvan") ||
    normalized.includes("hayvan bulma") ||
    normalized.includes("animal finder") ||
    normalized.includes("animal-finder")
  );
}

async function readExistingFile(
  file: string,
  maxChars = 30000
): Promise<string | null> {
  try {
    return await readFile(
      workspace,
      file,
      maxChars
    );
  } catch {
    return null;
  }
}

async function buildAnimalFinderEvidence(
  files: string[]
): Promise<string> {
  const required = [
    "src/pages/ActivitiesPage.tsx",
    "src/pages/ActivityDetailPage.tsx",
    "src/components/ActivityInteractionPanel.tsx",
    "src/components/games/AnimalFinderGame.tsx",
    "src/utils/audio.ts",
    "src/data/activityLibrary.ts",
    "src/data/allActivities.ts",
    "src/types/models.ts",
    "public/sounds/animals",
  ];

  const evidence: string[] = [];

  evidence.push(
    "=== ÇIRAK KESİN KANIT ZİNCİRİ ==="
  );

  /*
   * 1. Gerçek dosya varlık kontrolü
   */
  evidence.push("\n[1] DOSYA VARLIK KONTROLÜ");

  for (const file of required) {
    if (file === "public/sounds/animals") {
      const animalFiles = files.filter((x) =>
        x.startsWith(
          "public/sounds/animals/"
        )
      );

      evidence.push(
        `${file} -> ${
          animalFiles.length > 0
            ? "OK"
            : "YOK"
        }`
      );

      for (const animalFile of animalFiles) {
        evidence.push(
          `  - ${animalFile}`
        );
      }

      continue;
    }

    const exists = files.includes(file);

    evidence.push(
      `${file} -> ${
        exists ? "OK" : "YOK"
      }`
    );
  }

  /*
   * 2. Aktivite adını gerçek içerikte ara
   */
  evidence.push(
    "\n[2] SESLİ HAYVAN BULMA ARAMASI"
  );

  const activitySearch =
    await searchFiles(
      workspace,
      "Sesli Hayvan Bulma",
      files,
      30
    );

  if (activitySearch.length === 0) {
    evidence.push(
      "SONUÇ: 'Sesli Hayvan Bulma' ifadesi bulunamadı."
    );
  } else {
    for (const result of activitySearch) {
      evidence.push(
        `${result.file}:${result.line} -> ${result.text}`
      );
    }
  }

  /*
   * 3. animal-finder referanslarını bul
   */
  evidence.push(
    "\n[3] ANIMAL-FINDER REFERANSLARI"
  );

  const interactionSearch =
    await searchFiles(
      workspace,
      "animal-finder",
      files,
      50
    );

  if (interactionSearch.length === 0) {
    evidence.push(
      "SONUÇ: animal-finder bulunamadı."
    );
  } else {
    for (const result of interactionSearch) {
      evidence.push(
        `${result.file}:${result.line} -> ${result.text}`
      );
    }
  }

  /*
   * 4. Hayvan oyununu gerçek koddan oku
   */
  evidence.push(
    "\n[4] ANIMAL FINDER GAME GERÇEK KODU"
  );

  const gameText =
    await readExistingFile(
      "src/components/games/AnimalFinderGame.tsx",
      50000
    );

  if (!gameText) {
    evidence.push(
      "AnimalFinderGame.tsx okunamadı."
    );
  } else {
    evidence.push(gameText);
  }

  /*
   * 5. Audio sistemini gerçek koddan oku
   */
  evidence.push(
    "\n[5] AUDIO.TS GERÇEK KODU"
  );

  const audioText =
    await readExistingFile(
      "src/utils/audio.ts",
      50000
    );

  if (!audioText) {
    evidence.push(
      "audio.ts okunamadı."
    );
  } else {
    evidence.push(audioText);
  }

  /*
   * 6. Aktivite verisini oku
   */
  evidence.push(
    "\n[6] ACTIVITY LIBRARY İÇERİĞİ"
  );

  const libraryText =
    await readExistingFile(
      "src/data/activityLibrary.ts",
      80000
    );

  if (!libraryText) {
    evidence.push(
      "activityLibrary.ts okunamadı."
    );
  } else {
    /*
     * Tüm dev dosyayı Qwen'e göndermek yerine
     * Sesli Hayvan Bulma çevresindeki kanıtı çıkar.
     */
    const lines =
      libraryText.split(/\r?\n/);

    const hits: number[] = [];

    lines.forEach((line, index) => {
      const normalized =
        line.toLocaleLowerCase("tr-TR");

      if (
        normalized.includes(
          "sesli hayvan bulma"
        ) ||
        normalized.includes(
          "animal-finder"
        )
      ) {
        hits.push(index);
      }
    });

    if (hits.length === 0) {
      evidence.push(
        "İlgili aktivite satırı bulunamadı."
      );
    } else {
      const shown = new Set<number>();

      for (const hit of hits) {
        for (
          let i = Math.max(0, hit - 8);
          i <=
          Math.min(
            lines.length - 1,
            hit + 15
          );
          i++
        ) {
          if (!shown.has(i)) {
            shown.add(i);
            evidence.push(
              `${i + 1}: ${lines[i]}`
            );
          }
        }
      }
    }
  }

  /*
   * 7. allActivities kontrolü
   */
  evidence.push(
    "\n[7] ALL ACTIVITIES KONTROLÜ"
  );

  const allActivitiesText =
    await readExistingFile(
      "src/data/allActivities.ts",
      60000
    );

  if (!allActivitiesText) {
    evidence.push(
      "allActivities.ts okunamadı."
    );
  } else {
    const lines =
      allActivitiesText.split(/\r?\n/);

    lines.forEach((line, index) => {
      const normalized =
        line.toLocaleLowerCase("tr-TR");

      if (
        normalized.includes(
          "sesli hayvan bulma"
        ) ||
        normalized.includes(
          "animal-finder"
        )
      ) {
        evidence.push(
          `${index + 1}: ${line}`
        );
      }
    });
  }

  /*
   * 8. Interaction panel
   */
  evidence.push(
    "\n[8] INTERACTION PANEL"
  );

  const panelText =
    await readExistingFile(
      "src/components/ActivityInteractionPanel.tsx",
      50000
    );

  if (!panelText) {
    evidence.push(
      "ActivityInteractionPanel.tsx okunamadı."
    );
  } else {
    const lines =
      panelText.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (
        line
          .toLocaleLowerCase("tr-TR")
          .includes("animal-finder")
      ) {
        for (
          let i = Math.max(0, index - 5);
          i <=
          Math.min(
            lines.length - 1,
            index + 8
          );
          i++
        ) {
          evidence.push(
            `${i + 1}: ${lines[i]}`
          );
        }
      }
    });
  }

  /*
   * 9. Gerçek ses dosyaları
   */
  evidence.push(
    "\n[9] GERÇEK ANIMAL SOUND DOSYALARI"
  );

  const animalFiles = files.filter((x) =>
    x.startsWith(
      "public/sounds/animals/"
    )
  );

  for (const file of animalFiles) {
    evidence.push(
      file
    );
  }

  evidence.push(
    "\n=== KESİN KANIT ZİNCİRİ SONU ==="
  );

  return evidence.join("\n");
}

function sanitizeModelAnswer(
  answer: string,
  task: string
): string {
  /*
   * Animal Finder görevi için modelin
   * alakasız oyun uydurmasını yakala.
   */
  if (isAnimalFinderTask(task)) {
    const badGames = [
      "ComplexPuzzleGame",
      "MiniTetrisGame",
      "LogicGridGame",
      "MemoryGridGame",
      "StrategyMazeGame",
      "MissingShapeGame",
    ];

    const lower =
      answer.toLocaleLowerCase(
        "tr-TR"
      );

    const bad = badGames.find((game) =>
      lower.includes(
        game.toLocaleLowerCase(
          "tr-TR"
        )
      )
    );

    if (bad) {
      return `KANIT HATASI TESPİT EDİLDİ

Qwen analizinde "${bad}" bulundu.
Bu görev "Sesli Hayvan Bulma" olduğu için bu component
kanıt zincirinde doğrulanmadı.

Çırak güvenlik kuralı:
Qwen tarafından kanıtlanmamış component kabul edilmedi.

Ham Qwen cevabı:

${answer}`;
    }
  }

  return answer;
}

while (true) {
  const input = (
    await rl.question("Çırak > ")
  ).trim();

  if (!input) continue;

  if (
    input.toLocaleLowerCase(
      "tr-TR"
    ) === "exit"
  ) {
    break;
  }

  try {
    const files =
      await listFiles(workspace);

    if (
      input.toLocaleLowerCase(
        "tr-TR"
      ) === "files"
    ) {
      console.log(
        `\n${files.length} dosya bulundu.`
      );

      console.log(
        files
          .slice(0, 120)
          .join("\n")
      );

      console.log();
      continue;
    }

    const task =
      input.replace(
        /^analyze\s+/i,
        ""
      );

    console.log(
      "\n[1/4] Proje dosyaları taranıyor..."
    );

    console.log(
      "[2/4] Görevle ilişkili dosyalar gerçek içerikten belirleniyor..."
    );

    /*
     * Animal Finder özel görevinde zorunlu
     * dosyaları doğrudan dahil et.
     */
    let relevant =
      await pickRelevantFiles(
        workspace,
        files,
        task,
        14
      );

    if (isAnimalFinderTask(task)) {
      const forcedFiles = [
        "src/pages/ActivitiesPage.tsx",
        "src/pages/ActivityDetailPage.tsx",
        "src/components/ActivityInteractionPanel.tsx",
        "src/components/games/AnimalFinderGame.tsx",
        "src/utils/audio.ts",
        "src/data/activityLibrary.ts",
        "src/data/allActivities.ts",
        "src/types/models.ts",
        "src/data/activities.ts",
        "src/components/games/index.ts",
        "src/utils/dailyProgramEngine.ts",
      ];

      for (const file of forcedFiles) {
        if (
          files.includes(file) &&
          !relevant.some(
            (x) => x.file === file
          )
        ) {
          relevant.push({
            file,
            score: 100,
            evidence: [
              "Animal Finder görevi için zorunlu kanıt dosyası",
            ],
          });
        }
      }

      relevant =
        relevant.slice(0, 18);
    }

    console.log(
      "\nKANITLI İLGİLİ DOSYALAR:"
    );

    for (const item of relevant) {
      console.log(
        `- ${item.file} [skor: ${item.score}]`
      );

      for (const ev of item.evidence.slice(
        0,
        5
      )) {
        console.log(
          `  • ${ev}`
        );
      }
    }

    /*
     * Arama bulguları
     */
    const searchTerms =
      task
        .split(/\s+/)
        .filter(
          (x) => x.length >= 4
        )
        .slice(0, 4);

    const matches: Array<{
      file: string;
      line: number;
      text: string;
    }> = [];

    for (const term of searchTerms) {
      matches.push(
        ...await searchFiles(
          workspace,
          term,
          files,
          8
        )
      );
    }

    /*
     * Dosyaları seç.
     */
    const selected =
      Array.from(
        new Set([
          ...relevant.map(
            (x) => x.file
          ),
          ...matches.map(
            (x) => x.file
          ),
        ])
      ).slice(0, 18);

    console.log(
      `\n[3/4] ${selected.length} doğrulanmış aday dosya okunuyor...`
    );

    const context: string[] = [];

    for (const file of selected) {
      try {
        const text =
          await readFile(
            workspace,
            file,
            16000
          );

        context.push(
          `\n===== ${file} =====\n${text}`
        );
      } catch {
        // okunamayan dosya atlanır
      }
    }

    /*
     * Özel deterministik kanıt.
     */
    let deterministicEvidence = "";

    if (
      isAnimalFinderTask(task)
    ) {
      deterministicEvidence =
        await buildAnimalFinderEvidence(
          files
        );
    }

    const prompt = `
Sen Çırak'sın.
Yerel React/TypeScript projesini analiz eden bir kod ajanısın.

ÇOK ÖNEMLİ KURALLAR:

1. Sadece aşağıdaki GERÇEKTEN OKUNMUŞ dosyalara dayan.
2. Dosya adından tahmin yapma.
3. Genel React bilgisinden tahmin yapma.
4. Kanıtı olmayan hiçbir ID, component veya ses eşleşmesi uydurma.
5. Kullanıcı dosya değiştirmemi istemedi. HİÇBİR DOSYAYI DEĞİŞTİRME.
6. Komut çalıştırma.
7. Özellikle kanıt zincirinde olmayan başka bir game component seçme.
8. "ComplexPuzzleGame", "MiniTetrisGame" veya başka bir component ancak gerçek kanıt varsa kullanılabilir.
9. Kanıt yoksa açıkça "KANIT YOK" yaz.

KULLANICI GÖREVİ:
${task}

${deterministicEvidence}

GERÇEKTEN OKUNAN DOSYALAR:
${selected.join("\n")}

DOSYA İÇERİKLERİ:
${context.join("\n")}

ÇIKTIYI TAM OLARAK ŞU FORMATTA VER:

AKTİVİTE
ID: ...

interactionId: ...

OYUN COMPONENTİ
...

SES EŞLEŞMELERİ
- hayvan -> audio key -> gerçek dosya
...

TESPİT EDİLEN HATALAR
- Yok
veya
- Dosya/satır ve gerçek hata

DÜZELTME PLANI
1. ...
2. ...
3. ...

Tekrar söylüyorum:
KANIT YOKSA TAHMİN YAPMA.
`;

    console.log(
      "\n[4/4] Qwen analiz ediyor...\n"
    );

    const answer =
      await askOllama(prompt);

    console.log(
      sanitizeModelAnswer(
        answer,
        task
      )
    );

    console.log("\n");
  } catch (error) {
    console.error(
      "\nÇırak hatası:",
      error instanceof Error
        ? error.message
        : error
    );
  }
}

await rl.close();