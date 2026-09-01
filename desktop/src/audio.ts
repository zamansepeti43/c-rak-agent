import { spawn } from "node:child_process";

export type VoiceDirection = "speak" | "listen";

type SpeakOptions = {
  text: string;
  rate?: number;
  voice?: string;
};

/** Windows-first local voice bridge. */
export function speakLocal({ text, rate = 0, voice }: SpeakOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const escaped = text.replace(/'/g, "''");
    const rateLiteral = Math.max(-10, Math.min(10, Math.trunc(rate)));
    const voiceLiteral = voice?.trim()
      ? `$s.SelectVoice('${voice.trim().replace(/'/g, "''")}')`
      : "";
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.Rate=${rateLiteral}`,
      voiceLiteral,
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

/** STT is opt-in through CIRAK_STT_COMMAND; it must print recognized text to stdout. */
export function getSpeechToTextCommand(): string | null {
  return process.env.CIRAK_STT_COMMAND?.trim() || null;
}
