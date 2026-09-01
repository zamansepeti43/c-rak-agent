import readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";

import {
  listFiles,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  runCommand,
  searchFiles,
  pickRelevantFiles,
  type RelevantFile
} from "./workspace.js";

import {
  askOllama,
  askOllamaFast,
  checkOllama,
  MODEL
} from "./ollama.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const workspace =
  process.env.CIRAK_WORKSPACE ??
  path.resolve(
    process.cwd(),
    "..",
    "cocugumla-buyuyorum-app"
  );

const MAX_STEPS = 16;

type ToolAction =
  | {
      type: "tool";
      tool: "list_files";
    }
  | {
      type: "tool";
      tool: "read_file";
      path: string;
    }
  | {
      type: "tool";
      tool: "search_files";
      query: string;
    }
  | {
      type: "tool";
      tool: "write_file";
      path: string;
      content: string;
    }
  | {
      type: "tool";
      tool: "create_file";
      path: string;
      content: string;
    }
  | {
      type: "tool";
      tool: "delete_file";
      path: string;
    }
  | {
      type: "tool";
      tool: "run_command";
      command: string;
    }
  | {
      type: "final";
      summary: string;
    };

type ToolRecord = {
  key: string;
  action: ToolAction;
  result: string;
  ok: boolean;
};

function extractJson(
  text: string
): ToolAction | null {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  try {
    return JSON.parse(
      cleaned
    ) as ToolAction;
  } catch {
    const start =
      cleaned.indexOf("{");

    const end =
      cleaned.lastIndexOf("}");

    if (
      start === -1 ||
      end === -1 ||
      end <= start
    ) {
      return null;
    }

    try {
      return JSON.parse(
        cleaned.slice(
          start,
          end + 1
        )
      ) as ToolAction;
    } catch {
      return null;
    }
  }
}

function isAllowedCommand(
  command: string
): boolean {
  const normalized =
    command
      .trim()
      .toLowerCase();

  const allowed = [
    "npm ",
    "npm run",
    "npm test",
    "npm exec",
    "pnpm ",
    "pnpm run",
    "pnpm test",
    "yarn ",
    "yarn run",
    "node ",
    "npx ",
    "tsc ",
    "git status",
    "git diff",
    "git diff --check"
  ];

  if (
    !allowed.some(
      prefix =>
        normalized.startsWith(
          prefix
        )
    )
  ) {
    return false;
  }

  const blocked = [
    "shutdown",
    "restart-computer",
    "remove-item",
    "del /s",
    "rmdir /s",
    "rm -rf",
    "diskpart",
    "reg delete",
    "git reset --hard",
    "git clean -fd"
  ];

  return !blocked.some(
    item =>
      normalized.includes(item)
  );
}

function actionKey(
  action: ToolAction
): string {
  if (action.type === "final") {
    return "final";
  }

  switch (action.tool) {
    case "list_files":
      return "list_files";

    case "read_file":
      return `read_file:${action.path}`;

    case "search_files":
      return `search_files:${action.query
        .trim()
        .toLowerCase()}`;

    case "write_file":
      return `write_file:${action.path}`;

    case "create_file":
      return `create_file:${action.path}`;

    case "delete_file":
      return `delete_file:${action.path}`;

    case "run_command":
      return `run_command:${action.command}`;

    default:
      return "unknown";
  }
}

function parseResult(
  result: string
): {
  ok: boolean;
  error?: string;
} {
  try {
    const parsed =
      JSON.parse(result);

    return {
      ok: parsed.ok === true,
      error:
        parsed.error ??
        parsed.stderr ??
        undefined
    };
  } catch {
    return {
      ok: false,
      error: "GeÃ§ersiz araÃ§ sonucu"
    };
  }
}

function compact(
  text: string,
  max = 10000
): string {
  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max) +
    "\n\n[Ã‡Ä±ktÄ± kÄ±saltÄ±ldÄ±]"
  );
}

function isSimpleTask(
  task: string,
  action: ToolAction
): boolean {
  if (action.type !== "tool") {
    return false;
  }

  const text = task
    .toLocaleLowerCase("tr-TR")
    .trim();

  const simpleVerbs = [
    "oluÅŸtur",
    "oluÅŸturun",
    "oluÅŸtur ve iÃ§ine",
    "sil",
    "silin"
  ];

  const hasSimpleVerb =
    simpleVerbs.some(
      verb => text.includes(verb)
    );

  if (!hasSimpleVerb) {
    return false;
  }

  return (
    action.tool === "create_file" ||
    action.tool === "delete_file"
  );
}

type FastTask = {
  kind: "create" | "delete" | "read";
  path: string;
  content?: string;
};

function extractTaskPath(task: string): string | null {
  const normalized = task.replaceAll("\\", "/");

  const match = normalized.match(
    /(?:^|\s)((?:src\/)?[A-Za-z0-9_.@()\-\/]+\.[A-Za-z0-9]+)(?=\s|$|["'])/i
  );

  return match?.[1] ?? null;
}

function detectFastTask(task: string): FastTask | null {
  const text = task
    .toLocaleLowerCase("tr-TR")
    .trim();

  const filePath = extractTaskPath(task);

  if (!filePath) {
    return null;
  }

  const createRequested =
    /\b(oluÅŸtur|olustur|yarat)\b/i.test(text);

  const deleteRequested =
    /\b(sil|kaldÄ±r|kaldir)\b/i.test(text);

  const readRequested =
    /\b(oku|iÃ§eriÄŸini sÃ¶yle|icerigini soyle|iÃ§eriÄŸini gÃ¶ster|icerigini goster)\b/i.test(text);

  const codingWords =
    /\b(dÃ¼zelt|duzelt|refactor|geliÅŸtir|gelistir|hata|bug|build|lint|test et|analiz et|incele|deÄŸiÅŸtir|degistir)\b/i.test(text);

  if (codingWords) {
    return null;
  }

  if (createRequested) {
    const quoted =
      task.match(
        /(?:iÃ§ine|icine)[^"'â€œâ€]*["â€œ]([^"â€]+)["â€]/i
      ) ??
      task.match(
        /(?:iÃ§ine|icine)[^']*'([^']+)'/i
      );

    return {
      kind: "create",
      path: filePath,
      content: quoted?.[1]
    };
  }

  if (deleteRequested) {
    return {
      kind: "delete",
      path: filePath
    };
  }

  if (readRequested) {
    return {
      kind: "read",
      path: filePath
    };
  }

  return null;
}

function fastTaskPrompt(
  task: string,
  fastTask: FastTask
): string {
  if (fastTask.kind === "read") {
    return `
Sen Ã‡Ä±rak 0.5.6'sin.

KullanÄ±cÄ± belirli bir dosyayÄ± okuyup aÃ§Ä±klamanÄ± istiyor.
Ä°lk adÄ±mda SADECE dosyayÄ± oku.
Dosya iÃ§eriÄŸini aldÄ±ktan sonra tekrar araÃ§ Ã§aÄŸÄ±rma.
Dosya okunduktan sonra agent bu gÃ¶revi doÄŸrudan
hÄ±zlÄ± aÃ§Ä±klama aÅŸamasÄ±na geÃ§irir ve gÃ¶rev biter.

GÃ–REV:
${task}

DOSYA:
${fastTask.path}

SADECE ÅŸu JSON'u dÃ¶ndÃ¼r:
{"type":"tool","tool":"read_file","path":"${fastTask.path}"}

Markdown kullanma.
`;
  }

  return `
Sen Ã‡Ä±rak 0.5.6'sin.

KullanÄ±cÄ± basit, tek dosyalÄ± bir gÃ¶rev verdi.
Gereksiz proje analizi yapma.
Sadece gerekli aracÄ± seÃ§.

GÃ–REV:
${task}

TESPÄ°T EDÄ°LEN DOSYA:
${fastTask.path}

Ä°zin verilen cevaplar:

{"type":"tool","tool":"create_file","path":"${fastTask.path}","content":"..."}

{"type":"tool","tool":"delete_file","path":"${fastTask.path}"}

Her cevapta SADECE geÃ§erli JSON dÃ¶ndÃ¼r.
Markdown kullanma.
`;
}

function readExplainPrompt(
  task: string,
  path: string,
  result: string
): string {
  return `
Sen Ã‡Ä±rak 0.5.6'sin.

Dosya okuma iÅŸlemi baÅŸarÄ±yla tamamlandÄ±.
ArtÄ±k araÃ§ kullanma.
KullanÄ±cÄ±nÄ±n istediÄŸi aÃ§Ä±klamayÄ± doÄŸrudan ver.

GÃ–REV:
${task}

DOSYA:
${path}

DOSYA Ä°Ã‡ERÄ°ÄÄ°:
${result.slice(0, 12000)}

DosyanÄ±n ne yaptÄ±ÄŸÄ±nÄ± en fazla 5 kÄ±sa maddeyle aÃ§Ä±kla.
Gereksiz ayrÄ±ntÄ±ya girme.
Kodda deÄŸiÅŸiklik yapma.
Sadece normal metin cevap ver.
`;
}

function buildSystemPrompt(
  task: string,
  files: string[],
  relevant: string[],
  history: string,
  records: ToolRecord[]
): string {
  const recent =
    records
      .slice(-8)
      .map(
        record =>
          `ACTION: ${JSON.stringify(
            record.action
          )}\nRESULT: ${record.result}`
      )
      .join("\n\n");

  return `
Sen Ã‡Ä±rak 0.5.6'sin.

Sen gerÃ§ek bir CODING AGENT'sIN.
GerÃ§ek bir yazÄ±lÄ±m projesinde dosyalarÄ± okuyabilir,
arayabilir, oluÅŸturabilir, deÄŸiÅŸtirebilir, silebilir
ve gÃ¼venli terminal komutlarÄ± Ã§alÄ±ÅŸtÄ±rabilirsin.

WORKSPACE:
${workspace}

KULLANICI GÃ–REVÄ°:
${task}

MEVCUT DOSYALAR:
${files.slice(0, 300).join("\n")}

Ä°LGÄ°LÄ° DOSYALAR:
${relevant.join("\n")}

ARAÃ‡ GEÃ‡MÄ°ÅÄ°:
${history}

SON ARAÃ‡LAR:
${recent}

================================
ANA KURALLAR
================================

1. GerÃ§ek dosyayÄ± gÃ¶rmeden kod uydurma.

2. Var olan dosyayÄ± deÄŸiÅŸtirmeden Ã¶nce oku.

3. Gereksiz dosyalara dokunma.

4. Workspace dÄ±ÅŸÄ±na Ã§Ä±kma.

5. KullanÄ±cÄ±nÄ±n istemediÄŸi deÄŸiÅŸiklikleri yapma.

6. GÃ¶rev tamamlanmadan final verme.

7. Basit tek-adÄ±mlÄ± create_file veya delete_file iÅŸlemi
baÅŸarÄ±yla tamamlandÄ±ysa gereksiz ek araÃ§ kullanma.
Agent kodu baÅŸarÄ±lÄ± sonucu doÄŸrudan tamamlanmÄ±ÅŸ gÃ¶rev
olarak deÄŸerlendirebilir.

================================
ARAÃ‡LAR
================================

DosyalarÄ± listele:

{"type":"tool","tool":"list_files"}

Dosya oku:

{"type":"tool","tool":"read_file","path":"src/example.ts"}

Dosya ara:

{"type":"tool","tool":"search_files","query":"example"}

Dosya oluÅŸtur:

{"type":"tool","tool":"create_file","path":"src/example.txt","content":"..."}

Dosya deÄŸiÅŸtir:

{"type":"tool","tool":"write_file","path":"src/example.ts","content":"..."}

Dosya sil:

{"type":"tool","tool":"delete_file","path":"src/example.txt"}

Komut Ã§alÄ±ÅŸtÄ±r:

{"type":"tool","tool":"run_command","command":"npm run build"}

TamamlandÄ±:

{"type":"final","summary":"..."}

================================
ARAÃ‡ SONUÃ‡LARI
================================

Her araÃ§ sonucu gerÃ§ektir.

ok:true
â†’ iÅŸlem baÅŸarÄ±lÄ±.

ok:false
â†’ iÅŸlem baÅŸarÄ±sÄ±z.

Bir araÃ§ ok:false dÃ¶ndÃ¼rÃ¼rse bunu baÅŸarÄ±lÄ± kabul etme.

================================
TEKRAR KORUMASI
================================

BaÅŸarÄ±lÄ± bir iÅŸlemden sonra aynÄ± iÅŸlemi tekrar yapma.

Ã–rneÄŸin:

delete_file
â†’ ok:true

AynÄ± dosyaya tekrar delete_file Ã§aÄŸÄ±rma.

AynÄ± ÅŸekilde:

create_file
â†’ ok:true

aynÄ± dosyayÄ± tekrar create_file yapma.

write_file
â†’ ok:true

aynÄ± deÄŸiÅŸikliÄŸi tekrar yapma.

read_file
â†’ ok:true

aynÄ± dosyayÄ± tekrar okumaya Ã§alÄ±ÅŸma;
yeni bilgi gerekiyorsa farklÄ± bir araÃ§ veya iÅŸlem kullan.

search_files
â†’ sonuÃ§ boÅŸsa aynÄ± sorguyu tekrar etme.

================================
HATA KURALI
================================

ok:false aldÄ±ysan hemen final verme.

Ã–nce hatayÄ± analiz et.

Ã–rneÄŸin:

delete_file
â†’ ENOENT

Bu dosyanÄ±n artÄ±k bulunmadÄ±ÄŸÄ± anlamÄ±na gelir.

EÄŸer dosya daha Ã¶nce aynÄ± gÃ¶rev sÄ±rasÄ±nda
baÅŸarÄ±yla silindiyse, gÃ¶revin zaten tamamlandÄ±ÄŸÄ±nÄ±
anlayabilirsin.

Fakat bunu "ikinci silme baÅŸarÄ±lÄ± oldu" diye raporlama.

DoÄŸru rapor:

"Dosya ilk silme iÅŸleminde baÅŸarÄ±yla silindi.
Sonraki kontrol denemesinde dosyanÄ±n artÄ±k bulunmadÄ±ÄŸÄ± gÃ¶rÃ¼ldÃ¼."

================================
TEST KURALI
================================

Kod deÄŸiÅŸikliÄŸi yaptÄ±ysan doÄŸrulama yap.

Ã–nce package.json'daki scripts bÃ¶lÃ¼mÃ¼nÃ¼ kontrol et.

Mevcut scriptlerden uygun olanÄ± kullan.

Ã–ncelik:

build
test
lint

Projede olmayan bir scripti Ã§alÄ±ÅŸtÄ±rma.

"Missing script" alÄ±rsan aynÄ± komutu tekrar Ã§alÄ±ÅŸtÄ±rma.

================================
RECOVERY
================================

Komut hata verirse:

1. Hata mesajÄ±nÄ± oku.
2. GerÃ§ek nedeni belirle.
3. Ä°lgili dosyayÄ± oku.
4. Gerekli dÃ¼zeltmeyi yap.
5. Tekrar test et.

AynÄ± baÅŸarÄ±sÄ±z iÅŸlemi kÃ¶rlemesine tekrarlama.

================================
FINAL KURALI
================================

Final cevabÄ± yalnÄ±zca gerÃ§ek araÃ§ sonuÃ§larÄ±na dayanmalÄ±.

BaÅŸarÄ±sÄ±z bir iÅŸlemi baÅŸarÄ±lÄ± olarak gÃ¶sterme.

KullanÄ±cÄ±nÄ±n istediÄŸi gÃ¶rev gerÃ§ekten tamamlandÄ±ysa final ver.

GÃ¶rev tamamlanmadÄ±ysa araÃ§ kullanmaya devam et.

Her cevapta SADECE geÃ§erli JSON dÃ¶ndÃ¼r.

Markdown kullanma.
`;
}

async function executeTool(
  action: ToolAction,
  files: string[]
): Promise<string> {
  if (
    action.type !== "tool"
  ) {
    return "";
  }

  try {
    switch (
      action.tool
    ) {
      case "list_files": {
        const result =
          await listFiles(
            workspace
          );

        return JSON.stringify({
          ok: true,
          files:
            result.slice(0, 500)
        });
      }

      case "read_file": {
        const content =
          await readFile(
            workspace,
            action.path,
            30000
          );

        return JSON.stringify({
          ok: true,
          path:
            action.path,
          content
        });
      }

      case "search_files": {
        const result =
          await searchFiles(
            workspace,
            action.query,
            files,
            30
          );

        return JSON.stringify({
          ok: true,
          query:
            action.query,
          count:
            result.length,
          results:
            result
        });
      }

      case "write_file": {
        await writeFile(
          workspace,
          action.path,
          action.content
        );

        return JSON.stringify({
          ok: true,
          message:
            `Dosya yazÄ±ldÄ±: ${action.path}`
        });
      }

      case "create_file": {
        await createFile(
          workspace,
          action.path,
          action.content
        );

        return JSON.stringify({
          ok: true,
          message:
            `Dosya oluÅŸturuldu: ${action.path}`
        });
      }

      case "delete_file": {
        await deleteFile(
          workspace,
          action.path
        );

        return JSON.stringify({
          ok: true,
          message:
            `Dosya silindi: ${action.path}`
        });
      }

      case "run_command": {
        if (
          !isAllowedCommand(
            action.command
          )
        ) {
          return JSON.stringify({
            ok: false,
            error:
              "Bu terminal komutuna izin verilmiyor.",
            command:
              action.command
          });
        }

        const result =
          await runCommand(
            workspace,
            action.command
          );

        return JSON.stringify({
          ok:
            result.code === 0,
          command:
            action.command,
          code:
            result.code,
          stdout:
            compact(
              result.stdout
            ),
          stderr:
            compact(
              result.stderr
            )
        });
      }
    }
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}

async function runAgent(
  task: string
): Promise<void> {
  const fastTask =
    detectFastTask(task);

  let files: string[] = [];
  let relevant: RelevantFile[] = [];

  console.log(
    `\nWorkspace : ${workspace}`
  );

  if (fastTask) {
    console.log(
      "Mod       : HIZLI"
    );

    console.log(
      `Dosya     : ${fastTask.path}`
    );
  } else {
    files =
      await listFiles(
        workspace
      );

    relevant =
      await pickRelevantFiles(
        workspace,
        files,
        task,
        12
      );

    console.log(
      `Dosyalar  : ${files.length}`
    );

    console.log(
      "\nÄ°lgili dosyalar:"
    );

    for (
      const item of relevant
    ) {
      console.log(
        `- ${item.file} [${item.score}]`
      );
    }
  }

  /*
   * HIZLI OKUMA:
   * Dosyayı oku ve açıkla görevlerinde normal 16 adımlık
   * agent döngüsüne girme. Doğrudan dosyayı oku,
   * ardından hızlı model ile açıkla.
   */
  if (
    fastTask &&
    /\b(oku|okuyup|içeriğini söyle|icerigini soyle|içeriğini göster|icerigini goster)\b/i.test(task)
  ) {
    const directAction: ToolAction = {
      type: "tool",
      tool: "read_file",
      path: fastTask.path
    };

    console.log("\nAraç: read_file");
    console.log(`Dosya: ${fastTask.path}`);

    const directResult =
      await executeTool(
        directAction,
        files
      );

    const directParsed =
      parseResult(directResult);

    console.log(
      `Sonuç: ${compact(directResult, 1000)}`
    );

    if (!directParsed.ok) {
      console.log("\nDosya okunamadı.");
      console.log(
        directParsed.error ?? directResult
      );
      return;
    }

    const explanation =
      await askOllamaFast(
        readExplainPrompt(
          task,
          fastTask.path,
          directResult
        )
      );

    console.log("\nAçıklama:");
    console.log(explanation.trim());

    console.log(
      "\n================================"
    );
    console.log(
      "ÇIRAK 0.5.7 TAMAMLADI"
    );
    console.log(
      "================================\n"
    );

    return;
  }
  let history = "";

  const records:
    ToolRecord[] = [];

  const successfulActions =
    new Set<string>();

  const failedActions =
    new Set<string>();

  for (
    let step = 1;
    step <= MAX_STEPS;
    step++
  ) {
    console.log(
      `\n[${step}/${MAX_STEPS}] Ã‡Ä±rak dÃ¼ÅŸÃ¼nÃ¼yor...`
    );

    const prompt =
      fastTask
        ? fastTaskPrompt(
            task,
            fastTask
          )
        : buildSystemPrompt(
            task,
            files,
            relevant.map(
              item =>
                item.file
            ),
            history,
            records
          );

    const answer =
      await askOllama(
        prompt
      );

    const action =
      extractJson(
        answer
      );

    if (!action) {
      console.log(
        "\nGeÃ§erli JSON alÄ±namadÄ±."
      );

      history += `
Sistem:
GeÃ§erli JSON dÃ¶ndÃ¼rmedin.
Sadece JSON dÃ¶ndÃ¼r.
`;

      continue;
    }

    if (
      action.type ===
      "final"
    ) {
      /*
       * Son araÃ§ baÅŸarÄ±sÄ±zsa modelin
       * kafasÄ±na gÃ¶re baÅŸarÄ± ilan etmesini
       * engelle.
       */
      const last =
        records.at(-1);

      if (
        last &&
        !last.ok
      ) {
        console.log(
          "\nFinal engellendi: son araÃ§ baÅŸarÄ±sÄ±z."
        );

        history += `
Sistem:
Son araÃ§ baÅŸarÄ±sÄ±z oldu.
BaÅŸarÄ±sÄ±z iÅŸlemden sonra final veremezsin.
Ã–nce gÃ¶revin gerÃ§ekten tamamlanÄ±p
tamamlanmadÄ±ÄŸÄ±nÄ± doÄŸrula.
`;

        continue;
      }

      console.log(
        "\n================================"
      );

      console.log(
        "Ã‡IRAK 0.5.6 TAMAMLADI"
      );

      console.log(
        "================================\n"
      );

      console.log(
        action.summary
      );

      return;
    }

    const key =
      actionKey(
        action
      );

    /*
     * BaÅŸarÄ±lÄ± iÅŸlemi tekrar yaptÄ±rma.
     */
    if (
      successfulActions.has(
        key
      )
    ) {
      console.log(
        `\nEngellendi: baÅŸarÄ±lÄ± iÅŸlem tekrarlandÄ± -> ${key}`
      );

      history += `
Sistem:
Bu iÅŸlem daha Ã¶nce baÅŸarÄ±yla tamamlandÄ±:
${key}

AynÄ± iÅŸlemi tekrar yapma.
`;

      continue;
    }

    /*
     * AynÄ± baÅŸarÄ±sÄ±z iÅŸlemi de
     * kÃ¶rlemesine tekrar ettirme.
     */
    if (
      failedActions.has(
        key
      )
    ) {
      console.log(
        `\nEngellendi: baÅŸarÄ±sÄ±z iÅŸlem tekrarlandÄ± -> ${key}`
      );

      history += `
Sistem:
Bu iÅŸlem daha Ã¶nce baÅŸarÄ±sÄ±z oldu:
${key}

AynÄ± iÅŸlemi tekrar etme.
HatanÄ±n nedenini Ã§Ã¶z veya gÃ¶revi
baÅŸka bir yÃ¶ntemle doÄŸrula.
`;

      continue;
    }

    console.log(
      `AraÃ§: ${action.tool}`
    );

    if (
      action.type ===
        "tool" &&
      (
        action.tool ===
          "read_file" ||
        action.tool ===
          "write_file" ||
        action.tool ===
          "create_file" ||
        action.tool ===
          "delete_file"
      )
    ) {
      console.log(
        `Dosya: ${action.path}`
      );
    }

    if (
      action.type ===
        "tool" &&
      action.tool ===
        "search_files"
    ) {
      console.log(
        `Arama: ${action.query}`
      );
    }

    if (
      action.type ===
        "tool" &&
      action.tool ===
        "run_command"
    ) {
      console.log(
        `Komut: ${action.command}`
      );
    }

    const result =
      await executeTool(
        action,
        files
      );

    const parsed =
      parseResult(
        result
      );

    console.log(
      `SonuÃ§: ${compact(
        result,
        1000
      )}`
    );

    records.push({
      key,
      action,
      result:
        compact(
          result,
          6000
        ),
      ok:
        parsed.ok
    });

    if (
      parsed.ok
    ) {
      successfulActions.add(
        key
      );
    } else {
      failedActions.add(
        key
      );
    }

    /*
     * Hedefli "dosyayÄ± oku ve aÃ§Ä±kla" gÃ¶revlerinde
     * workspace taramasÄ± yapma ve read_file iÅŸlemini
     * tekrar ettirme. Sadece aÃ§Ä±klama iÃ§in ikinci,
     * kÄ±sa bir LLM Ã§aÄŸrÄ±sÄ± yap.
     */
    if (
      parsed.ok &&
      fastTask?.kind === "read" &&
      action.type === "tool" &&
      action.tool === "read_file"
    ) {
      const explanation =
        await askOllamaFast(
          readExplainPrompt(
            task,
            action.path,
            result
          )
        );

      console.log(
        "\nAÃ§Ä±klama:"
      );

      console.log(
        explanation.trim()
      );

      console.log(
        "\n================================"
      );

      console.log(
        "Ã‡IRAK 0.5.6 TAMAMLADI"
      );

      console.log(
        "================================\n"
      );

      return;
    }

    /*
     * Basit tek-adÄ±mlÄ± dosya gÃ¶revlerinde
     * ikinci kez Ollama Ã§aÄŸÄ±rma.
     */
    if (
      parsed.ok &&
      isSimpleTask(task, action)
    ) {
      console.log(
        "\n================================"
      );

      console.log(
        "Ã‡IRAK 0.5.6 TAMAMLADI"
      );

      console.log(
        "================================\n"
      );

      console.log(
        "GÃ¶rev baÅŸarÄ±yla tamamlandÄ±."
      );

      return;
    }

    history += `
================================
ADIM ${step}
================================

Ä°ÅŸlem:
${JSON.stringify(
  action
)}

SonuÃ§:
${result}

Ä°ÅŸlem durumu:
${
  parsed.ok
    ? "BAÅARILI"
    : "BAÅARISIZ"
}
`;

    if (
      !fastTask &&
      action.type ===
        "tool" &&
      (
        action.tool ===
          "write_file" ||
        action.tool ===
          "create_file" ||
        action.tool ===
          "delete_file"
      ) &&
      parsed.ok
    ) {
      files =
        await listFiles(
          workspace
        );
    }

    /*
     * BaÅŸarÄ±sÄ±z komut iÃ§in gÃ¼Ã§lÃ¼ recovery
     * bilgisi ekle.
     */
    if (
      !parsed.ok
    ) {
      history += `
RECOVERY:

Bu iÅŸlem baÅŸarÄ±sÄ±z oldu.

Hata:
${parsed.error ?? result}

AynÄ± iÅŸlemi tekrar etme.

HatanÄ±n nedenini analiz et.
Gerekirse ilgili dosyayÄ± oku.
Gerekirse farklÄ± bir araÃ§ kullan.
`;
    }
  }

  console.log(
    "\nÃ‡Ä±rak maksimum iÅŸlem sayÄ±sÄ±na ulaÅŸtÄ±."
  );

  console.log(
    "GÃ¶rev otomatik olarak tamamlanamadÄ±."
  );
}

async function main() {
  console.log(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘       Ã‡IRAK CODE AGENT v0.5.5        â•‘
â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£
â•‘ Model     : ${MODEL}
â•‘ Workspace : ${workspace}
â•‘ Mod       : CODING AGENT
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
`);

  if (
    !(await checkOllama())
  ) {
    console.error(
      "\nOllama baÄŸlantÄ±sÄ± yok."
    );

    console.error(
      "AyrÄ± terminalde 'ollama serve' Ã§alÄ±ÅŸtÄ±r."
    );

    process.exit(1);
  }

  console.log(
    "Ollama    : OK"
  );

  console.log(
    "\nKomutlar:"
  );

  console.log(
    "analyze <gÃ¶rev>"
  );

  console.log(
    "files"
  );

  console.log(
    "exit"
  );

  while (true) {
    const input =
      (
        await rl.question(
          "\nÃ‡Ä±rak > "
        )
      ).trim();

    if (!input) {
      continue;
    }

    if (
      input.toLowerCase() ===
      "exit"
    ) {
      break;
    }

    try {
      if (
        input.toLowerCase() ===
        "files"
      ) {
        const files =
          await listFiles(
            workspace
          );

        console.log(
          `\n${files.length} dosya bulundu.`
        );

        console.log(
          files
            .slice(
              0,
              150
            )
            .join("\n")
        );

        continue;
      }

      const task =
        input.replace(
          /^analyze\s+/i,
          ""
        );

      if (!task) {
        console.log(
          "GÃ¶rev belirtmelisin."
        );

        continue;
      }

      await runAgent(
        task
      );
    } catch (error) {
      console.error(
        "\nÃ‡Ä±rak hatasÄ±:",
        error instanceof Error
          ? error.message
          : error
      );
    }
  }

  await rl.close();
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exit(1);
  }
);



