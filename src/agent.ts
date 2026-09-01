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
  type RelevantFile,
} from "./workspace.js";

import {
  askOllama,
  askOllamaFast,
  askOllamaVideo,
  checkOllama,
  MODEL,
} from "./ollama.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const workspace = process.env.CIRAK_WORKSPACE ?? path.resolve(process.cwd());
const videoEngine = process.env.CIRAK_VIDEO_ENGINE ?? path.resolve(process.cwd(), "video-engine");
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

type ToolRecord = { key: string; action: ToolAction; result: string; ok: boolean };

function extractJson(text: string): ToolAction | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned) as ToolAction; } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)) as ToolAction; } catch { return null; }
  }
}

function isAllowedCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const allowed = ["npm ", "npm run", "npm test", "npm exec", "pnpm ", "pnpm run", "pnpm test", "yarn ", "yarn run", "node ", "npx ", "tsc ", "git status", "git diff", "git diff --check"];
  if (!allowed.some((prefix) => normalized.startsWith(prefix))) return false;
  const blocked = ["shutdown", "restart-computer", "remove-item", "del /s", "rmdir /s", "rm -rf", "diskpart", "reg delete", "git reset --hard", "git clean -fd"];
  return !blocked.some((item) => normalized.includes(item));
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
  }
}

function parseResult(result: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(result);
    return { ok: parsed.ok === true, error: parsed.error ?? parsed.stderr ?? undefined };
  } catch { return { ok: false, error: "Geçersiz araç sonucu" }; }
}

function compact(text: string, max = 10000): string {
  return text.length <= max ? text : text.slice(0, max) + "\n\n[Çıktı kısaltıldı]";
}

function normalizeCommandText(text: string): string {
  return text.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u").replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c").trim();
}

function isVideoRequest(text: string): boolean {
  const normalized = normalizeCommandText(text);
  return /\b(video|videoyu|video\s+uret|video\s+olustur|video\s+hazirla|cocuk\s+hikayesi|cocuk\s+hikayesi\s+uret|cocuk\s+hikayesi\s+olustur|hikaye\s+uret|hikaye\s+olustur|masal\s+uret|masal\s+olustur|animasyon\s+uret|animasyon\s+olustur)\b/i.test(normalized);
}

async function executeVideoProducer(prompt: string): Promise<string> {
  const script = path.join(videoEngine, "cirak_video_pipeline.py");
  if (!fs.existsSync(script)) return JSON.stringify({ ok: false, error: `Video engine bulunamadı: ${script}` });
  const python = process.env.CIRAK_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const command = `${python} ${JSON.stringify(script)} ${JSON.stringify(prompt)}`;
  const result = await runCommand(videoEngine, command, 30 * 60 * 1000);
  return JSON.stringify({ ok: result.code === 0, command, stdout: compact(result.stdout, 16000), stderr: compact(result.stderr, 8000) });
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
      case "video_producer": return executeVideoProducer(action.prompt);
    }
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function parseSimpleFileTask(task: string): { action: ToolAction; response: string } | null {
  const normalized = normalizeCommandText(task);
  if (!/(masaustunde|masaustu|desktop)/i.test(normalized)) return null;
  const createMatch = normalized.match(/(?:adinda|isimli)\s+([\w.-]+)\s+adli\s+bir\s+dosya\s+olustur/i);
  const contentMatch = task.match(/icine\s+["“”']([^"“”']+)["“”']/i);
  if (!createMatch) return null;
  const filename = createMatch[1];
  const content = contentMatch?.[1] ?? "";
  const desktopDir = path.join(path.dirname(workspace), "Desktop");
  const target = path.resolve(desktopDir, filename);
  const relativePath = path.relative(workspace, target);
  return {
    action: { type: "tool", tool: "create_file", path: target, content },
    response: `Dosya oluşturuldu: ${target}`
  };
}

async function runAgent(task: string): Promise<void> {
  if (isVideoRequest(task)) {
    console.log("\nÇırak: Video Engine başlatılıyor...");
    const result = await executeTool({ type: "tool", tool: "video_producer", prompt: task }, []);
    const parsed = parseResult(result);
    console.log(`\n${compact(result, 16000)}`);
    console.log(parsed.ok ? "\nÇırak: Video üretimi tamamlandı." : "\nÇırak: Video üretimi başarısız.");
    return;
  }

  const simpleFile = parseSimpleFileTask(task);
  if (simpleFile) {
    const result = await executeTool(simpleFile.action, []);
    const parsed = parseResult(result);
    if (parsed.ok) {
      console.log(`\n${simpleFile.response}`);
    } else {
      console.log(`\nÇırak: Dosya oluşturulamadı. ${parsed.error ?? "Bilinmeyen hata"}`);
    }
    return;
  }

  const normalizedTask = normalizeCommandText(task);
  const chatTask = !/\b(olustur|sil|kaldir|oku|incele|analiz|duzelt|degistir|gelistir|refactor|bug|hata|test et|build|lint|dosya|kod)\b/i.test(normalizedTask);
  if (chatTask) {
    const answer = await askOllamaFast(`Sen Çırak'sın. Kullanıcıyla Türkçe doğal konuş.\nKULLANICI:\n${task}`);
    console.log("\n" + answer.trim());
    return;
  }

  const files = await listFiles(workspace);
  const relevant: RelevantFile[] = await pickRelevantFiles(workspace, files, task, 12);
  const history: string[] = [];
  const records: ToolRecord[] = [];
  const used = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = buildSystemPrompt(task, files, relevant.map((r) => `${r.file} [${r.score}]`), history.join("\n"), records);
    const action = extractJson(await askOllama(prompt));
    if (!action) { console.log("\nÇırak: Geçerli bir araç kararı üretemedi."); return; }
    if (action.type === "final") { console.log("\n" + action.summary); return; }
    const key = actionKey(action);
    if (used.has(key)) { history.push(`Tekrar engellendi: ${key}`); continue; }
    used.add(key);
    const result = await executeTool(action, files);
    const parsed = parseResult(result);
    records.push({ key, action, result, ok: parsed.ok });
    history.push(`ACTION: ${JSON.stringify(action)}\nRESULT: ${compact(result, 6000)}`);
    console.log(`\nAraç: ${action.tool}\n${compact(result, 1500)}`);
    if (!parsed.ok) continue;
  }
  console.log("\nÇırak: Görev adım sınırına ulaştı.");
}

function buildSystemPrompt(task: string, files: string[], relevant: string[], history: string, records: ToolRecord[]): string {
  const recent = records.slice(-8).map((r) => `ACTION: ${JSON.stringify(r.action)}\nRESULT: ${r.result}`).join("\n\n");
  return `Sen Çırak 0.6'sın. Gerçek bir coding ve desktop agent'sın.\n\nWORKSPACE:\n${workspace}\n\nGÖREV:\n${task}\n\nMEVCUT DOSYALAR:\n${files.slice(0, 300).join("\n")}\n\nİLGİLİ DOSYALAR:\n${relevant.join("\n")}\n\nARAÇ GEÇMİŞİ:\n${history}\n\nSON ARAÇLAR:\n${recent}\n\nKurallar:\n1. Gerçek dosyayı görmeden kod uydurma.\n2. Var olan dosyayı değiştirmeden önce oku.\n3. Workspace dışına çıkma.\n4. Hatalı sonucu başarılı kabul etme.\n5. Değişiklik yaptıysan doğrulama yap.\n\nAraçlar:\n{"type":"tool","tool":"list_files"}\n{"type":"tool","tool":"read_file","path":"src/example.ts"}\n{"type":"tool","tool":"search_files","query":"example"}\n{"type":"tool","tool":"write_file","path":"src/example.ts","content":"..."}\n{"type":"tool","tool":"create_file","path":"src/example.txt","content":"..."}\n{"type":"tool","tool":"delete_file","path":"src/example.txt"}\n{"type":"tool","tool":"run_command","command":"npm run build"}\n{"type":"tool","tool":"video_producer","prompt":"1 dakikalık çocuk hikayesi videosu üret"}\n\nHer cevapta SADECE geçerli JSON döndür.`;
}

async function main(): Promise<void> {
  console.log(`\nÇırak 0.6 hazır. Model: ${MODEL}`);
  console.log(`Workspace: ${workspace}`);
  console.log(`Video Engine: ${videoEngine}`);
  console.log("Çıkmak için: exit\n");
  if (!(await checkOllama())) console.log("Uyarı: Ollama erişilebilir değil.");
  while (true) {
    const task = (await rl.question("Çırak > ")).trim();
    if (!task) continue;
    if (task.toLocaleLowerCase("tr-TR") === "exit") break;
    try { await runAgent(task); } catch (error) { console.error("\nHata:", error instanceof Error ? error.message : error); }
  }
  rl.close();
}

void main();
