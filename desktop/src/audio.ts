import { spawn } from "node:child_process";

export type VoiceDirection = "speak" | "listen";

type SpeakOptions = {
  text: string;
  rate?: number;
  voice?: string;
};

/**
 * Windows-first local voice bridge.
 *
 * STT intentionally stays opt-in through a configurable command so the
 * desktop app does not pretend that a microphone stack is installed when it
 * is not. TTS uses PowerShell's built-in SpeechSynthesizer by default.
 */
export function speakLocal({ text, rate = 0 }: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const escaped = text.replace(/'/g, "''");
    const rateLiteral = Math.max(-10, Math.min(10, Math.trunc(rate)));
    const voiceClause = "";
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.Rate=${rateLiteral}`,
      voiceClause,
      `$s.Speak('${escaped}')`,
      "$s.Dispose()",
    ].filter(Boolean).join(";");

    const child = spawn(
      process.platform === "win32" ? "powershell.exe" : "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `TTS exited with code ${code}`));
    });
  });
}

export function getSpeechToTextCommand(): string | null {
  const configured = process.env.CIRAK_STT_COMMAND?.trim();
  return configured || null;
}
