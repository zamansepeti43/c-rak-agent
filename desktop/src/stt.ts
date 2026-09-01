import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SttEngine = "auto" | "whisper" | "command";

export type SttResult = {
  text: string;
  engine: SttEngine;
};

function configuredCommand(): string | null {
  const value = process.env.CIRAK_STT_COMMAND?.trim();
  return value || null;
}

function whisperCommand(): { exe: string; args: string[] } | null {
  const python = process.env.CIRAK_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const script = process.env.CIRAK_WHISPER_SCRIPT?.trim();
  if (script && fs.existsSync(script)) {
    return { exe: python, args: [script, "--language", "tr"] };
  }
  return null;
}

export function sttAvailability(): { command: boolean; whisper: boolean } {
  return { command: Boolean(configuredCommand()), whisper: Boolean(whisperCommand()) };
}

export async function transcribeOnce(engine: SttEngine = "auto"): Promise<SttResult> {
  if (engine === "command" || (engine === "auto" && configuredCommand())) {
    return { text: await runCapture(configuredCommand()!), engine: "command" };
  }
  if (engine === "whisper" || engine === "auto") {
    const command = whisperCommand();
    if (command) {
      return { text: await runProcess(command.exe, command.args), engine: "whisper" };
    }
  }
  throw new Error(
    "Türkçe STT hazır değil. CIRAK_STT_COMMAND veya CIRAK_WHISPER_SCRIPT ayarla."
  );
}

function runCapture(command: string): Promise<string> {
  const parts = command.split(" ").filter(Boolean);
  const exe = parts.shift();
  if (!exe) return Promise.reject(new Error("STT komutu boş."));
  return runProcess(exe, parts);
}

function runProcess(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      cwd: process.env.CIRAK_WORKSPACE || process.cwd(),
      env: { ...process.env, LANG: process.env.LANG || "tr_TR.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `STT exited with code ${code}`));
    });
  });
}

export function defaultTempAudioPath(): string {
  return path.join(os.tmpdir(), `cirak-stt-${Date.now()}.wav`);
}
