import { contextBridge, ipcRenderer } from "electron";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

type CirakApi = {
  sendTask: (text: string) => void;
  startAgent: () => void;
  hide: () => void;
  quit: () => void;
  speak: (text: string) => Promise<void>;
  listen: (engine?: "auto" | "whisper" | "command") => Promise<{ text: string; engine: string }>;
  onOutput: (callback: (text: string) => void) => () => void;
  onStatus: (callback: (status: string) => void) => () => void;
  onVoiceState: (callback: (state: VoiceState) => void) => () => void;
};

contextBridge.exposeInMainWorld("cirak", {
  sendTask: (text: string) => ipcRenderer.send("task", text),
  startAgent: () => ipcRenderer.send("start-agent"),
  hide: () => ipcRenderer.send("hide-window"),
  quit: () => ipcRenderer.send("quit-app"),
  speak: (text: string) => ipcRenderer.invoke("voice-speak", text),
  listen: (engine: "auto" | "whisper" | "command" = "auto") => ipcRenderer.invoke("voice-listen", engine),
  onOutput: (callback: (text: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on("agent-output", listener);
    return () => ipcRenderer.removeListener("agent-output", listener);
  },
  onStatus: (callback: (status: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on("agent-status", listener);
    return () => ipcRenderer.removeListener("agent-status", listener);
  },
  onVoiceState: (callback: (state: VoiceState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: VoiceState) => callback(state);
    ipcRenderer.on("voice-state", listener);
    return () => ipcRenderer.removeListener("voice-state", listener);
  },
} satisfies CirakApi);

declare global {
  interface Window {
    cirak: CirakApi;
  }
}
