import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cirak", {
  sendTask: (text: string) => ipcRenderer.send("task", text),
  startAgent: () => ipcRenderer.send("start-agent"),
  hide: () => ipcRenderer.send("hide-window"),
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
});
