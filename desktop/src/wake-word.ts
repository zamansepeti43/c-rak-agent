import { spawn } from "node:child_process";

export type WakeWordController = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

export function createWakeWordController(onWake: () => void): WakeWordController {
  let child: ReturnType<typeof spawn> | null = null;
  let running = false;

  const start = () => {
    if (running) return;
    const command = process.env.CIRAK_WAKE_COMMAND?.trim();
    if (!command) return;

    const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) ?? [];
    const exe = parts.shift();
    if (!exe) return;

    child = spawn(exe, parts.map(p => p.replace(/^\"|\"$/g, "")), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      cwd: process.env.CIRAK_WORKSPACE || process.cwd(),
    });
    running = true;

    let buffer = "";
    child.stdout?.on("data", data => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const value = line.trim().toLocaleLowerCase("tr-TR");
        if (value === "cirak" || value.includes("cirak_wake") || value.includes("wake")) onWake();
      }
    });
    child.once("close", () => {
      running = false;
      child = null;
    });
    child.once("error", () => {
      running = false;
      child = null;
    });
  };

  const stop = () => {
    if (!child) return;
    child.kill();
    child = null;
    running = false;
  };

  return { start, stop, isRunning: () => running };
}
