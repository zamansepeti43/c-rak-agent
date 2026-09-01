import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultTempAudioPath, SttEngine, transcribeOnce } from "./stt";

export type VoiceInputOptions = {
  engine?: SttEngine;
  captureCommand?: string;
  timeoutMs?: number;
};

export async function listenAndTranscribe(options: VoiceInputOptions = {}): Promise<string> {
  const output = defaultTempAudioPath();
  try {
    if (options.captureCommand?.trim()) {
      await runCaptureCommand(options.captureCommand, output, options.timeoutMs ?? 30_000);
    } else {
      const command = process.env.CIRAK_MIC_CAPTURE_COMMAND?.trim();
      if (!command) {
        throw new Error(
          "Mikrofon yakalama komutu ayarlı değil. CIRAK_MIC_CAPTURE_COMMAND ile WAV üreten bir komut tanımla."
        );
      }
      await runCaptureCommand(command, output, options.timeoutMs ?? 30_000);
    }

    if (!fs.existsSync(output) || fs.statSync(output).size < 1000) {
      throw new Error("Mikrofon kaydı boş veya geçersiz.");
    }

    process.env.CIRAK_STT_AUDIO = output;
    return (await transcribeOnce(options.engine ?? "auto")).text;
  } finally {
    try {
      fs.rmSync(output, { force: true });
    } catch {
      // Temp cleanup is best effort.
    }
  }
}

function runCaptureCommand(command: string, output: string, timeoutMs: number): Promise<void> {
  const rendered = command
    .replaceAll("{output}", quote(output))
    .replaceAll("{duration}", "8")
    .replaceAll("{sampleRate}", "16000");
  const parts = splitCommand(rendered);
  const exe = parts.shift();
  if (!exe) throw new Error("Mikrofon komutu boş.");

  return new Promise((resolve, reject) => {
    const child = spawn(exe, parts, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.env.CIRAK_WORKSPACE || process.cwd(),
      env: process.env,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Mikrofon kaydı zaman aşımına uğradı."));
    }, timeoutMs);
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Mikrofon komutu ${code} koduyla bitti.`));
    });
  });
}

function splitCommand(command: string): string[] {
  const matches = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) || [];
  return matches.map(part => part.replace(/^\"|\"$/g, ""));
}

function quote(value: string): string {
  return process.platform === "win32" ? `\"${value.replaceAll('"', '\\"')}\"` : `'${value.replaceAll("'", "'\\''")}'`;
}
