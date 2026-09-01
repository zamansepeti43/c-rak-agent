import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: ChildProcessWithoutNullStreams | null = null;

function projectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function startAgent() {
  if (agent && !agent.killed) return;
  const root = projectRoot();
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/c", "npm.cmd", "run", "dev"] : ["run", "dev"];
  agent = spawn(command, args, {
    cwd: root,
    env: { ...process.env, CIRAK_DESKTOP: "1" },
    windowsHide: true,
  });
  agent.stdout.on("data", (data) => mainWindow?.webContents.send("agent-output", data.toString()));
  agent.stderr.on("data", (data) => mainWindow?.webContents.send("agent-output", data.toString()));
  agent.on("close", () => { agent = null; mainWindow?.webContents.send("agent-status", "stopped"); });
  mainWindow?.webContents.send("agent-status", "running");
}

function sendTask(text: string) {
  if (!agent || agent.killed || !agent.stdin.writable) startAgent();
  if (agent?.stdin.writable) agent.stdin.write(text.trim() + "\n");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: "Çırak",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#08090c",
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  startAgent();
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Çırak");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Çırak'ı Aç", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Çıkış", click: () => { app.isQuiting = true; app.quit(); } },
  ]));
});

ipcMain.on("task", (_event, text: string) => sendTask(text));
ipcMain.on("start-agent", () => startAgent());
ipcMain.on("hide-window", () => mainWindow?.hide());

app.on("before-quit", () => {
  app.isQuiting = true;
  agent?.kill();
});
