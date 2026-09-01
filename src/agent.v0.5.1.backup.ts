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
  pickRelevantFiles
} from "./workspace.js";

import {
  askOllama,
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
      error: "Geçersiz araç sonucu"
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
    "\n\n[Çıktı kısaltıldı]"
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
    "oluştur",
    "oluşturun",
    "oluştur ve içine",
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
Sen Çırak 0.5.2'sin.

Sen gerçek bir CODING AGENT'sIN.
Gerçek bir yazılım projesinde dosyaları okuyabilir,
arayabilir, oluşturabilir, değiştirebilir, silebilir
ve güvenli terminal komutları çalıştırabilirsin.

WORKSPACE:
${workspace}

KULLANICI GÖREVİ:
${task}

MEVCUT DOSYALAR:
${files.slice(0, 300).join("\n")}

İLGİLİ DOSYALAR:
${relevant.join("\n")}

ARAÇ GEÇMİŞİ:
${history}

SON ARAÇLAR:
${recent}

================================
ANA KURALLAR
================================

1. Gerçek dosyayı görmeden kod uydurma.

2. Var olan dosyayı değiştirmeden önce oku.

3. Gereksiz dosyalara dokunma.

4. Workspace dışına çıkma.

5. Kullanıcının istemediği değişiklikleri yapma.

6. Görev tamamlanmadan final verme.

7. Basit tek-adımlı create_file veya delete_file işlemi
başarıyla tamamlandıysa gereksiz ek araç kullanma.
Agent kodu başarılı sonucu doğrudan tamamlanmış görev
olarak değerlendirebilir.

================================
ARAÇLAR
================================

Dosyaları listele:

{"type":"tool","tool":"list_files"}

Dosya oku:

{"type":"tool","tool":"read_file","path":"src/example.ts"}

Dosya ara:

{"type":"tool","tool":"search_files","query":"example"}

Dosya oluştur:

{"type":"tool","tool":"create_file","path":"src/example.txt","content":"..."}

Dosya değiştir:

{"type":"tool","tool":"write_file","path":"src/example.ts","content":"..."}

Dosya sil:

{"type":"tool","tool":"delete_file","path":"src/example.txt"}

Komut çalıştır:

{"type":"tool","tool":"run_command","command":"npm run build"}

Tamamlandı:

{"type":"final","summary":"..."}

================================
ARAÇ SONUÇLARI
================================

Her araç sonucu gerçektir.

ok:true
→ işlem başarılı.

ok:false
→ işlem başarısız.

Bir araç ok:false döndürürse bunu başarılı kabul etme.

================================
TEKRAR KORUMASI
================================

Başarılı bir işlemden sonra aynı işlemi tekrar yapma.

Örneğin:

delete_file
→ ok:true

Aynı dosyaya tekrar delete_file çağırma.

Aynı şekilde:

create_file
→ ok:true

aynı dosyayı tekrar create_file yapma.

write_file
→ ok:true

aynı değişikliği tekrar yapma.

read_file
→ ok:true

aynı dosyayı tekrar okumaya çalışma;
yeni bilgi gerekiyorsa farklı bir araç veya işlem kullan.

search_files
→ sonuç boşsa aynı sorguyu tekrar etme.

================================
HATA KURALI
================================

ok:false aldıysan hemen final verme.

Önce hatayı analiz et.

Örneğin:

delete_file
→ ENOENT

Bu dosyanın artık bulunmadığı anlamına gelir.

Eğer dosya daha önce aynı görev sırasında
başarıyla silindiyse, görevin zaten tamamlandığını
anlayabilirsin.

Fakat bunu "ikinci silme başarılı oldu" diye raporlama.

Doğru rapor:

"Dosya ilk silme işleminde başarıyla silindi.
Sonraki kontrol denemesinde dosyanın artık bulunmadığı görüldü."

================================
TEST KURALI
================================

Kod değişikliği yaptıysan doğrulama yap.

Önce package.json'daki scripts bölümünü kontrol et.

Mevcut scriptlerden uygun olanı kullan.

Öncelik:

build
test
lint

Projede olmayan bir scripti çalıştırma.

"Missing script" alırsan aynı komutu tekrar çalıştırma.

================================
RECOVERY
================================

Komut hata verirse:

1. Hata mesajını oku.
2. Gerçek nedeni belirle.
3. İlgili dosyayı oku.
4. Gerekli düzeltmeyi yap.
5. Tekrar test et.

Aynı başarısız işlemi körlemesine tekrarlama.

================================
FINAL KURALI
================================

Final cevabı yalnızca gerçek araç sonuçlarına dayanmalı.

Başarısız bir işlemi başarılı olarak gösterme.

Kullanıcının istediği görev gerçekten tamamlandıysa final ver.

Görev tamamlanmadıysa araç kullanmaya devam et.

Her cevapta SADECE geçerli JSON döndür.

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
            `Dosya yazıldı: ${action.path}`
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
            `Dosya oluşturuldu: ${action.path}`
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
  let files =
    await listFiles(
      workspace
    );

  const relevant =
    await pickRelevantFiles(
      workspace,
      files,
      task,
      12
    );

  console.log(
    `\nWorkspace : ${workspace}`
  );

  console.log(
    `Dosyalar  : ${files.length}`
  );

  console.log(
    "\nİlgili dosyalar:"
  );

  for (
    const item of relevant
  ) {
    console.log(
      `- ${item.file} [${item.score}]`
    );
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
      `\n[${step}/${MAX_STEPS}] Çırak düşünüyor...`
    );

    const prompt =
      buildSystemPrompt(
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
        "\nGeçerli JSON alınamadı."
      );

      history += `
Sistem:
Geçerli JSON döndürmedin.
Sadece JSON döndür.
`;

      continue;
    }

    if (
      action.type ===
      "final"
    ) {
      /*
       * Son araç başarısızsa modelin
       * kafasına göre başarı ilan etmesini
       * engelle.
       */
      const last =
        records.at(-1);

      if (
        last &&
        !last.ok
      ) {
        console.log(
          "\nFinal engellendi: son araç başarısız."
        );

        history += `
Sistem:
Son araç başarısız oldu.
Başarısız işlemden sonra final veremezsin.
Önce görevin gerçekten tamamlanıp
tamamlanmadığını doğrula.
`;

        continue;
      }

      console.log(
        "\n================================"
      );

      console.log(
        "ÇIRAK 0.5.2 TAMAMLADI"
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
     * Başarılı işlemi tekrar yaptırma.
     */
    if (
      successfulActions.has(
        key
      )
    ) {
      console.log(
        `\nEngellendi: başarılı işlem tekrarlandı -> ${key}`
      );

      history += `
Sistem:
Bu işlem daha önce başarıyla tamamlandı:
${key}

Aynı işlemi tekrar yapma.
`;

      continue;
    }

    /*
     * Aynı başarısız işlemi de
     * körlemesine tekrar ettirme.
     */
    if (
      failedActions.has(
        key
      )
    ) {
      console.log(
        `\nEngellendi: başarısız işlem tekrarlandı -> ${key}`
      );

      history += `
Sistem:
Bu işlem daha önce başarısız oldu:
${key}

Aynı işlemi tekrar etme.
Hatanın nedenini çöz veya görevi
başka bir yöntemle doğrula.
`;

      continue;
    }

    console.log(
      `Araç: ${action.tool}`
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
      `Sonuç: ${compact(
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
     * Basit tek-adımlı dosya görevlerinde
     * ikinci kez Ollama çağırma.
     */
    if (
      parsed.ok &&
      isSimpleTask(task, action)
    ) {
      console.log(
        "\n================================"
      );

      console.log(
        "ÇIRAK 0.5.2 TAMAMLADI"
      );

      console.log(
        "================================\n"
      );

      console.log(
        "Görev başarıyla tamamlandı."
      );

      return;
    }

    history += `
================================
ADIM ${step}
================================

İşlem:
${JSON.stringify(
  action
)}

Sonuç:
${result}

İşlem durumu:
${
  parsed.ok
    ? "BAŞARILI"
    : "BAŞARISIZ"
}
`;

    if (
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
     * Başarısız komut için güçlü recovery
     * bilgisi ekle.
     */
    if (
      !parsed.ok
    ) {
      history += `
RECOVERY:

Bu işlem başarısız oldu.

Hata:
${parsed.error ?? result}

Aynı işlemi tekrar etme.

Hatanın nedenini analiz et.
Gerekirse ilgili dosyayı oku.
Gerekirse farklı bir araç kullan.
`;
    }
  }

  console.log(
    "\nÇırak maksimum işlem sayısına ulaştı."
  );

  console.log(
    "Görev otomatik olarak tamamlanamadı."
  );
}

async function main() {
  console.log(`
╔══════════════════════════════════════╗
║       ÇIRAK CODE AGENT v0.5.2        ║
╠══════════════════════════════════════╣
║ Model     : ${MODEL}
║ Workspace : ${workspace}
║ Mod       : CODING AGENT
╚══════════════════════════════════════╝
`);

  if (
    !(await checkOllama())
  ) {
    console.error(
      "\nOllama bağlantısı yok."
    );

    console.error(
      "Ayrı terminalde 'ollama serve' çalıştır."
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
    "analyze <görev>"
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
          "\nÇırak > "
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
          "Görev belirtmelisin."
        );

        continue;
      }

      await runAgent(
        task
      );
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
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exit(1);
  }
);