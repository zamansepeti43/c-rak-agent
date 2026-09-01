import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SttEngine = "auto" | "whisper" | "command";
export type SttResult = { text: string; engine: SttEngine };

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function whisperCommand(): { exe: string; args: string[] } | null {
  const python = env("CIRAK_PYTHON") ?? (process.platform === "win32" ? "python" : "python3");
  const script = env("CIRAK_WHISPER_SCRIPT");
  if (script && fs.existsSync(script)) return { exe: python, args: [script, "--language", "tr", "--audio", env("CIRAK_STT_AUDIO") ?? "{audio}"] };
  return null;
}

function commandTemplate(): string | null { return env("CIRAK_STT_COMMAND"); }

export function sttAvailability() {
  return { command: Boolean(commandTemplate()), whisper: Boolean(whisperCommand()), audio: Boolean(env("CIRAK_STT_AUDIO")) };
}

export async function transcribeOnce(engine: SttEngine = "auto", audioPath?: string): Promise<SttResult> {
  const audio = audioPath ?? env("CIRAK_STT_AUDIO");
  if (!audio) throw new Error("STT için ses dosyası bulunamadı.");

  if (engine === "command" || (engine === "auto" && commandTemplate())) {
    const command = commandTemplate()!.replaceAll("{audio}", quote(audio));
    return { text: await runCommand(command), engine: "command" };
  }

  if (engine === "whisper" || engine === "auto") {
    const configured = whisperCommand();
    if (configured) {
      const args = configured.args.map(arg => arg.replaceAll("{audio}", audio));
      return { text: await runProcess(configured.exe, args), engine: "whisper" };
    }
  }

  throw new Error("Türkçe STT hazır değil. CIRAK_WHISPER_SCRIPT veya CIRAK_STT_COMMAND ayarla.");
}

function runCommand(command: string): Promise<string> {
  const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) ?? [];
  const exe = parts.shift()?.replace(/^\"|\"$/g, "");
  if (!exe) return Promise.reject(new Error("STT komutu boş."));
  return runProcess(exe, parts.map(part => part.replace(/^\"|\"$/g, "")));
}

function runProcess(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, cwd: process.env.CIRAK_WORKSPACE || process.cwd(), env: { ...process.env, LANG: process.env.LANG || "tr_TR.UTF-8" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `STT exited with code ${code}`)));
  });
}

function quote(value: string): string {
  return process.platform === "win32" ? `\"${value.replaceAll('"', '\\"')}\"` : `'${value.replaceAll("'", "'\\''")}'`;
}

export function defaultTempAudioPath(): string {
  return path.join(os.tmpdir(), `cirak-stt-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
}
