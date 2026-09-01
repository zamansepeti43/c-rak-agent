"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_child_process_1 = require("node:child_process");
let agent;
const debugChannel = vscode.window.createOutputChannel("Çırak Debug");
class CirakProvider {
    extensionUri;
    static viewType = "cirak.chat";
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    resolveWebviewView(webviewView) {
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.html();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            debugChannel.appendLine(`[webview->ext] type=${message.type} text=${String(message.text ?? "").slice(0, 120)}`);
            if (message.type !== "task") {
                debugChannel.appendLine(`[webview->ext] ignored non-task message`);
                return;
            }
            const task = String(message.text ?? "").trim();
            if (!task) {
                debugChannel.appendLine(`[webview->ext] empty task, ignored`);
                return;
            }
            try {
                await this.ensureAgent(webviewView);
                if (agent && !agent.killed && agent.stdin.writable) {
                    debugChannel.appendLine(`[stdin] writing task: ${task.slice(0, 50)}`);
                    agent.stdin.write(task + "\n");
                    debugChannel.appendLine(`[stdin] write succeeded`);
                }
                else {
                    const reason = !agent ? "no agent" : agent.killed ? "agent killed" : "stdin not writable";
                    debugChannel.appendLine(`[stdin] skipped; reason=${reason}`);
                    webviewView.webview.postMessage({
                        type: "output",
                        text: "\n[Çırak: agent hazır değil. Panelı kapatıp tekrar açın.]\n"
                    });
                }
            }
            catch (error) {
                debugChannel.appendLine(`[error] ${error instanceof Error ? error.message : String(error)}`);
                webviewView.webview.postMessage({
                    type: "output",
                    text: "\n[Çırak hatası: " + (error instanceof Error ? error.message : String(error)) + "]\n"
                });
            }
        });
    }
    async ensureAgent(view) {
        if (agent && !agent.killed) {
            debugChannel.appendLine(`[ensureAgent] reusing existing agent pid=${agent.pid}`);
            return;
        }
        const root = "C:\\Users\\Quantum\\Desktop\\cirak-code-agent";
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) {
            debugChannel.appendLine(`[env] no workspace folder open`);
            view.webview.postMessage({
                type: "output",
                text: "Açık bir workspace bulunamadı."
            });
            return;
        }
        debugChannel.appendLine(`[env] workspace=${workspace}`);
        debugChannel.appendLine(`[env] cwd=${root}`);
        const command = process.platform === "win32" ? "cmd.exe" : "npm";
        const args = process.platform === "win32"
            ? ["/c", "npm.cmd", "run", "dev"]
            : ["run", "dev"];
        debugChannel.appendLine(`[spawn] command=${command} args=${JSON.stringify(args)}`);
        try {
            agent = (0, node_child_process_1.spawn)(command, args, {
                cwd: root,
                env: {
                    ...process.env,
                    CIRAK_WORKSPACE: workspace
                }
            });
        }
        catch (error) {
            debugChannel.appendLine(`[spawn] failed: ${error instanceof Error ? error.message : String(error)}`);
            view.webview.postMessage({
                type: "output",
                text: "\n[Çırak başlatılamadı: " + (error instanceof Error ? error.message : String(error)) + "]\n"
            });
            return;
        }
        debugChannel.appendLine(`[spawn] pid=${agent.pid}`);
        agent.stdout.on("data", (data) => {
            const text = data.toString();
            debugChannel.appendLine(`[stdout] ${text.slice(0, 400)}`);
            view.webview.postMessage({
                type: "output",
                text
            });
        });
        agent.stderr.on("data", (data) => {
            const text = data.toString();
            debugChannel.appendLine(`[stderr] ${text.slice(0, 400)}`);
            view.webview.postMessage({
                type: "output",
                text
            });
        });
        agent.on("error", (error) => {
            debugChannel.appendLine(`[error] ${error.message}`);
            view.webview.postMessage({
                type: "output",
                text: "\n[Çırak hatası: " + error.message + "]\n"
            });
        });
        agent.on("exit", (code, signal) => {
            debugChannel.appendLine(`[exit] code=${code} signal=${signal}`);
        });
        agent.on("close", (code, signal) => {
            debugChannel.appendLine(`[close] code=${code} signal=${signal}`);
            agent = undefined;
        });
    }
    html() {
        return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<style>
body {
  font-family: var(--vscode-font-family);
  padding: 10px;
}
#output {
  white-space: pre-wrap;
  font-size: 12px;
  margin-bottom: 10px;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 80px;
  resize: vertical;
}
button {
  width: 100%;
  margin-top: 8px;
  padding: 7px;
}
</style>
</head>
<body>

<h3>🤖 Çırak</h3>

<div id="output">
Çırak hazır.
</div>

<textarea
  id="task"
  placeholder="Çırağa bir görev ver..."
></textarea>

<button id="send">Gönder</button>

<script>
const vscode = acquireVsCodeApi();

const output = document.getElementById("output");
const task = document.getElementById("task");
const send = document.getElementById("send");

send.addEventListener("click", () => {
  const text = task.value.trim();
  if (!text) return;

  output.textContent += "\\n\\n> " + text;
  vscode.postMessage({
    type: "task",
    text
  });

  task.value = "";
});

task.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    send.click();
  }
});

window.addEventListener("message", event => {
  if (event.data.type === "output") {
    output.textContent += event.data.text;
    output.scrollTop = output.scrollHeight;
  }
});
</script>

</body>
</html>`;
    }
}
function activate(context) {
    context.subscriptions.push(debugChannel);
    const provider = new CirakProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CirakProvider.viewType, provider));
    context.subscriptions.push(vscode.commands.registerCommand("cirak.open", () => {
        vscode.commands.executeCommand("workbench.view.extension.cirak");
    }));
}
function deactivate() {
    agent?.kill();
    agent = undefined;
}
