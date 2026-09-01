# Çırak Desktop

Windows-first desktop shell for Çırak.

## Current architecture

- Electron desktop window + system tray
- Shared Çırak agent process
- Secure context-isolated IPC
- Local Windows TTS via `System.Speech`
- Pluggable microphone capture + Turkish STT
- Optional wake-word bridge

## Voice setup

The desktop voice layer intentionally does not invent a microphone backend. Set:

- `CIRAK_MIC_CAPTURE_COMMAND`: a command that records a WAV file. Use `{output}` for the destination path, `{duration}` for seconds, and `{sampleRate}` for the sample rate.
- `CIRAK_WHISPER_SCRIPT`: optional local Python Whisper wrapper accepting `--language tr --audio <path>` and printing the transcript to stdout.
- `CIRAK_STT_COMMAND`: optional direct STT command. It receives `{audio}` and must print recognized text to stdout.
- `CIRAK_WAKE_COMMAND`: optional long-running wake-word process. Print `cirak` on stdout when the wake word is detected.

Without these settings, text chat and local TTS still work; the microphone and wake word report that they are not configured instead of pretending they are active.

## Run

From `desktop/`:

```powershell
npm install
npm run build
npm start
```

For development:

```powershell
npm run dev
```
