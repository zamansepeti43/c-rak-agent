import { speakLocal, getSpeechToTextCommand } from "./audio";
import { spawn } from "node:child_process";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceController = {
  getState: () => VoiceState;
  speak: (text: string) => Promise<void>;
  listenOnce: () => Promise<string>;
};

export function createVoiceController(onState?: (state: VoiceState) => void): VoiceController {
  let state: VoiceState = "idle";
  const setState = (next: VoiceState) => {
    state = next;
    onState?.(next);
  };

  return {
    getState: () => state,
    async speak(text: string) {
      if (!text.trim()) return;
      setState("speaking");
      try {
        await speakLocal({ text });
      } finally {
        setState("idle");
      }
    },
    async listenOnce() {
      const command = getSpeechToTextCommand();
      if (!command) {
        throw new Error("STT kurulumu yapılmamış. CIRAK_STT_COMMAND ayarla.");
      }
      setState("listening");
      try {
        return await runCaptureCommand(command);
      } finally {
        setState("idle");
      }
    },
  };
}

function runCaptureCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [exe, ...args] = command.split(" ").filter(Boolean);
    if (!exe) {
      reject(new Error("STT komutu boş."));
      return;
    }
    const child = spawn(exe, args, {
      windowsHide: true,
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
