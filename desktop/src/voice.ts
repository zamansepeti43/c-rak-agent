import { speakLocal } from "./audio";
import { transcribeOnce, SttEngine, SttResult } from "./stt";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceController = {
  getState: () => VoiceState;
  speak: (text: string) => Promise<void>;
  listenOnce: (engine?: SttEngine) => Promise<SttResult>;
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
    async listenOnce(engine = "auto") {
      setState("listening");
      try {
        return await transcribeOnce(engine);
      } finally {
        setState("idle");
      }
    },
  };
}
