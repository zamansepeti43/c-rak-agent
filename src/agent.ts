import readline from "node:readline/promises";
import path from "node:path";
import fs from "node:fs";
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
  askOllamaVideo,
  checkOllama,
  MODEL
} from "./ollama.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const workspace =
  process.env.CIRAK_WORKSPACE ??
  path.resolve(process.cwd());

const MAX_STEPS = 16;

type ToolAction =
  | { type: "tool"; tool: "list_files" }
  | { type: "tool"; tool: "read_file"; path: string }
  | { type: "tool"; tool: "search_files"; query: string }
  | { type: "tool"; tool: "write_file"; path: string; content: string }
  | { type: "tool"; tool: "create_file"; path: string; content: string }
  | { type: "tool"; tool: "delete_file"; path: string }
  | { type: "tool"; tool: "run_command"; command: string }
  | { type: "tool"; tool: "video_producer"; prompt: string }
  | { type: "final"; summary: string };

type ToolRecord = {
  key: string;
  action: ToolAction;
  result: string;
  ok: boolean;
};

function extractJson(text: string): ToolAction | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  try {
    return JSON.parse(cleaned) as ToolAction;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)) as ToolAction; } catch { return null; }
  }
}

function isAllowedCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const allowed = ["npm ", "npm run", "npm test", "npm exec", "pnpm ", "pnpm run", "pnpm test", "yarn ", "yarn run", "node ", "npx ", "tsc ", "tsc", "git status", "git diff", "git diff --check"];
  if (!allowed.some(prefix => normalized.startsWith(prefix))) return false;
  const blocked = ["shutdown", "restart-computer", "remove-item", "del /s", "rmdir /s", "rm -rf", "diskpart", "reg delete", "git reset --hard", "git clean -fd"];
  return !blocked.some(item => normalized.includes(item));
}

function actionKey(action: ToolAction): string {
  if (action.type === "final") return "final";
  switch (action.tool) {
    case "list_files": return "list_files";
    case "read_file": return `read_file:${action.path}`;
    case "search_files": return `search_files:${action.query.trim().toLowerCase()}`;
    case "write_file": return `write_file:${action.path}`;
    case "create_file": return `create_file:${action.path}`;
    case "delete_file": return `delete_file:${action.path}`;
    case "run_command": return `run_command:${action.command}`;
    case "video_producer": return `video_producer:${action.prompt}`;
    default: return "unknown";
  }
}

function parseResult(result: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(result);
    return { ok: parsed.ok === true, error: parsed.error ?? parsed.stderr ?? undefined };
  } catch {
    return { ok: false, error: "Geçersiz araç sonucu" };
  }
}

function compact(text: string, max = 10000): string {
  return text.length <= max ? text : text.slice(0, max) + "\n\n[Çıktı kısaltıldı]";
}

function normalizeCommandText(text: string): string {
  return text.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u").replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c").trim();
}

function isSimpleTask(task: string, action: ToolAction): boolean {
  if (action.type !== "tool") return false;
  const text = normalizeCommandText(task);
  const simpleVerbs = ["olustur", "olusturun", "sil", "silin"];
  if (!simpleVerbs.some(verb => text.includes(verb))) return false;
  return action.tool === "create_file" || action.tool === "delete_file";
}

type FastTask = { kind: "create" | "delete" | "read"; path: string; content?: string };

function extractTaskPath(task: string): string | null {
  const normalized = task.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\s)((?:src\/)?[A-Za-z0-9_.@()\-\/]+\.[A-Za-z0-9]+)(?=\s|$|["'])/i);
  return match?.[1] ?? null;
}

function detectFastTask(task: string): FastTask | null {
  const text = normalizeCommandText(task);
  const filePath = extractTaskPath(task);
  if (!filePath) return null;
  const createRequested = /\b(olustur|yarat)\b/i.test(text);
  const deleteRequested = /\b(sil|kaldir)\b/i.test(text);
  const readRequested = /\b(oku|icerigini\s+soyle|icerigini\s+goster)\b/i.test(text);
  const codingWords = /\b(duzelt|degistir|gelistir|refactor|hata|bug|build|lint|test\s+et|analiz\s+et|incele)\b/i.test(text);
  if (codingWords) return null;
  if (createRequested) {
    const quoted = task.match(/(?:icine|içine)\s*["“]([^"”]+)["”]/i) ?? task.match(/(?:icine|içine)\s*'([^']+)'/i);
    return { kind: "create", path: filePath, content: quoted?.[1] ?? "" };
  }
  if (deleteRequested) return { kind: "delete", path: filePath };
  if (readRequested) return { kind: "read", path: filePath };
  return null;
}

function readExplainPrompt(task: string, filePath: string, result: string): string {
  return `Dosya okundu. Araç kullanma. Türkçe ve en fazla 5 kısa madde ile açıkla. Görev: ${task}\nDosya: ${filePath}\nİçerik:\n${result.slice(0, 12000)}`;
}

function buildSystemPrompt(task: string, files: string[], relevant: string[], history: string, records: ToolRecord[]): string {
  const recent = records.slice(-8).map(r => `ACTION: ${JSON.stringify(r.action)}\nRESULT: ${r.result}`).join("\n\n");
  return `
Sen Çırak 0.5.6'sın. Gerçek bir coding agent'sın.
WORKSPACE: ${workspace}
KULLANICI GÖREVİ: ${task}
MEVCUT DOSYALAR:\n${files.slice(0, 300).join("\n")}
İLGİLİ DOSYALAR:\n${relevant.join("\n")}
ARAÇ GEÇMİŞİ:\n${history}
SON ARAÇLAR:\n${recent}

Kurallar:
1. Gerçek dosyayı görmeden kod uydurma.
2. Var olan dosyayı değiştirmeden önce oku.
3. Gereksiz dosyalara dokunma.
4. Workspace dışına çıkma.
5. Kullanıcının istemediği değişiklikleri yapma.
6. Görev tamamlanmadan final verme.
7. Araç sonucu ok:false ise başarısız kabul et.
8. Başarılı işlemi körlemesine tekrar etme.
9. Kod değişikliğinden sonra uygun build/test/lint çalıştır.
10. Video üretme isteğinde video_producer aracını kullan.

Araçlar:
{"type":"tool","tool":"list_files"}
{"type":"tool","tool":"read_file","path":"src/example.ts"}
{"type":"tool","tool":"search_files","query":"example"}
{"type":"tool","tool":"write_file","path":"src/example.ts","content":"..."}
{"type":"tool","tool":"create_file","path":"src/example.txt","content":"..."}
{"type":"tool","tool":"delete_file","path":"src/example.txt"}
{"type":"tool","tool":"run_command","command":"npm run build"}
{"type":"tool","tool":"video_producer","prompt":"..."}
{"type":"final","summary":"..."}

Her cevapta sadece geçerli JSON döndür. Markdown kullanma.`;
}

async function executeTool(action: ToolAction, files: string[]): Promise<string> {
  if (action.type !== "tool") return "";
  try {
    switch (action.tool) {
      case "list_files": return JSON.stringify({ ok: true, files: (await listFiles(workspace)).slice(0, 500) });
      case "read_file": return JSON.stringify({ ok: true, path: action.path, content: await readFile(workspace, action.path, 30000) });
      case "search_files": return JSON.stringify({ ok: true, query: action.query, results: await searchFiles(workspace, action.query, files, 30) });
      case "write_file": await writeFile(workspace, action.path, action.content); return JSON.stringify({ ok: true, message: `Dosya yazıldı: ${action.path}` });
      case "create_file": await createFile(workspace, action.path, action.content); return JSON.stringify({ ok: true, message: `Dosya oluşturuldu: ${action.path}` });
      case "delete_file": await deleteFile(workspace, action.path); return JSON.stringify({ ok: true, message: `Dosya silindi: ${action.path}` });
      case "run_command": {
        if (!isAllowedCommand(action.command)) return JSON.stringify({ ok: false, error: "Bu terminal komutuna izin verilmiyor.", command: action.command });
        const result = await runCommand(workspace, action.command);
        return JSON.stringify({ ok: result.code === 0, command: action.command, code: result.code, stdout: compact(result.stdout), stderr: compact(result.stderr) });
      }
      case "video_producer": {
        const videoEngine = process.env.CIRAK_VIDEO_ENGINE ?? path.resolve(process.cwd(), "video-engine");
        const python = process.env.CIRAK_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
        const script = path.join(videoEngine, "cirak_video_pipeline.py");
        if (!fs.existsSync(script)) {
          return JSON.stringify({ ok: false, error: `Video engine bulunamadı: ${script}` });
        }
        const result = await runCommand(videoEngine, `${python} ${JSON.stringify(script)} ${JSON.stringify(action.prompt)}`, 20 * 60 * 1000);
        return JSON.stringify({ ok: result.code === 0, output: compact(result.stdout, 12000), error: compact(result.stderr, 6000) });
      }
    }
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function runAgent(task: string): Promise<void> {
  const fastTask = detectFastTask(task);
  const normalizedTask = normalizeCommandText(task);
  const videoRequested = /\b(video|videoyu|video\s+uret|video\s+olu[s?]tur|video\s+hazirla|cocuk\s+hikayesi|hikaye\s+uret|hikaye\s+olu[s?]tur|masal\s+uret|masal\s+olu[s?]tur|animasyon\s+uret|animasyon\s+olu[s?]tur)\b/i.test(normalizedTask);

  if (videoRequested) {
    console.log("\nÇırak: Video Engine başlatılıyor...");
    const videoResult = await executeTool({ type: "tool", tool: "video_producer", prompt: task }, []);
    const parsed = parseResult(videoResult);
    console.log(`\n${compact(videoResult, 12000)}`);
    console.log(parsed.ok ? "\nÇırak: Video üretimi tamamlandı." : "\nÇırak: Video üretimi başarısız.");
    return;
  }

  const chatTask = !fastTask && !/\b(olustur|sil|kaldir|oku|incele|analiz|duzelt|degistir|gelistir|refactor|bug|hata|test et|build|lint|dosya|kod)\b/i.test(normalizedTask);
  if (chatTask) {
    const answer = await askOllamaFast(`Sen Çırak'sın. Kullanıcıyla Türkçe doğal konuş.\nKULLANICI:\n${task}`);
    console.log("\n" + answer.trim());
    return;
  }

  let files: string[] = [];
  let relevant: RelevantFile[] = [];
  if (fastTask) {
    files = await listFiles(workspace);
  } else {
    files = await listFiles(workspace);
    relevant = await pickRelevantFiles(workspace, files, task, 12);
  }

  if (fastTask && /\b(oku|okuyup|icerigini\s+soyle|icerigini\s+goster)\b/i.test(normalizedTask)) {
    const directResult = await executeTool({ type: "tool", tool: "read_file", path: fastTask.path }, files);
    const parsed = parseResult(directResult);
    if (!parsed.ok) { console.log("\nDosya okunamadı.\n" + (parsed.error ?? directResult)); return; }
    console.log("\n" + (await askOllamaFast(readExplainPrompt(task, fastTask.path, directResult))).trim());
    return;
  }

  const history: string[] = [];
  const records: ToolRecord[] = [];
  const used = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = buildSystemPrompt(task, files, relevant.map(r => `${r.file} [${r.score}]`), history.join("\n"), records);
    const raw = await askOllamaVideo(prompt);
    const action = extractJson(raw);
    if (!action) {
      console.log("\nÇırak:", raw.trim());
      return;
    }
    if (action.type === "final") {
      console.log("\n" + action.summary);
      return;
    }

    const key = actionKey(action);
    if (used.has(key)) {
      history.push(`Tekrar engellendi: ${key}`);
      continue;
    }
    used.add(key);
    const result = await executeTool(action, files);
    const parsed = parseResult(result);
    records.push({ key, action, result, ok: parsed.ok });
    history.push(`ACTION: ${JSON.stringify(action)}\nRESULT: ${compact(result, 6000)}`);
    console.log(`\nAraç: ${action.tool}\n${compact(result, 1000)}`);
    if (parsed.ok && isSimpleTask(task, action)) {
      console.log("\nÇırak: İşlem tamamlandı.");
      return;
    }
  }
  console.log("\nÇırak: Görev adım sınırına ulaştı.");
}

async function main(): Promise<void> {
  console.log(`\nÇırak 0.5.6 hazır. Model: ${MODEL}`);
  console.log(`Workspace: ${workspace}`);
  console.log("Çıkmak için: exit\n");
  const ollamaReady = await checkOllama();
  if (!ollamaReady) console.log("Uyarı: Ollama erişilebilir değil.");
  while (true) {
    const task = (await rl.question("Çırak > ")).trim();
    if (!task) continue;
    if (task.toLocaleLowerCase("tr-TR") === "exit") break;
    try { await runAgent(task); } catch (error) { console.error("\nHata:", error instanceof Error ? error.message : error); }
  }
  rl.close();
}

void main();
