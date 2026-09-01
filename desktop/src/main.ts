import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from "electron";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createVoiceController, VoiceState } from "./voice";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: ChildProcessWithoutNullStreams | null = null;
let isQuitting = false;

function projectRoot(): string { return path.resolve(__dirname, "../.."); }

function startAgent() {
  if (agent && !agent.killed) return;
  const root = projectRoot();
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/c", "npm.cmd", "run", "dev"] : ["run", "dev"];
  agent = spawn(command, args, {
    cwd: root,
    env: { ...process.env, CIRAK_DESKTOP: "1", CIRAK_WORKSPACE: root },
    windowsHide: true,
  });
  agent.stdout.on("data", data => mainWindow?.webContents.send("agent-output", data.toString()));
  agent.stderr.on("data", data => mainWindow?.webContents.send("agent-output", data.toString()));
  agent.on("close", () => { agent = null; mainWindow?.webContents.send("agent-status", "stopped"); });
  agent.on("error", error => mainWindow?.webContents.send("agent-output", `\n[Agent error] ${error.message}\n`));
  mainWindow?.webContents.send("agent-status", "running");
}

function sendTask(text: string) {
  if (!text.trim()) return;
  if (!agent || agent.killed || !agent.stdin.writable) startAgent();
  if (agent?.stdin.writable) agent.stdin.write(text.trim() + "\n");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 780, minWidth: 820, minHeight: 600, title: "Çırak",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
    backgroundColor: "#08090c",
  });

  const htmlPath = path.join(__dirname, "index.html");
  mainWindow.loadFile(htmlPath).catch(error => {
    mainWindow?.webContents.openDevTools({ mode: "detach" });
    mainWindow?.webContents.send("agent-output", `[UI load error] ${String(error)}`);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    mainWindow?.webContents.openDevTools({ mode: "detach" });
    mainWindow?.webContents.send("agent-output", `[UI failed] ${errorCode}: ${errorDescription}`);
  });

  mainWindow.on("close", event => { if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); } });
}

const voice = createVoiceController((state: VoiceState) => mainWindow?.webContents.send("voice-state", state));

app.whenReady().then(() => {
  createWindow();
  startAgent();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Çırak");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Çırak'ı Aç", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Agent'ı Başlat", click: () => startAgent() },
    { label: "GitHub Reposu", click: () => void shell.openExternal("https://github.com/zamansepeti43/c-rak-agent") },
    { type: "separator" },
    { label: "Çıkış", click: () => { isQuitting = true; app.quit(); } },
  ]));
});

ipcMain.on("task", (_event, text: string) => sendTask(text));
ipcMain.on("start-agent", () => startAgent());
ipcMain.on("hide-window", () => mainWindow?.hide());
ipcMain.on("quit-app", () => { isQuitting = true; app.quit(); });
ipcMain.handle("voice-speak", async (_event, text: string) => { await voice.speak(text); return true; });
ipcMain.handle("voice-listen", async (_event, engine: "auto" | "whisper" | "command" = "auto") => voice.listenOnce(engine));

app.on("before-quit", () => { isQuitting = true; agent?.kill(); });
