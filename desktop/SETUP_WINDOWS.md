# Çırak Desktop — Windows Kurulum

## 1) Repo'yu güncelle

VS Code'da Çırak repo klasörünü açın ve:

```powershell
git pull origin main
```

## 2) Desktop bağımlılıkları

```powershell
cd desktop
npm install
npm run build
```

## 3) Çalıştır

```powershell
npm start
```

## 4) Türkçe STT

Desktop voice katmanı `auto`, `whisper` ve `command` modlarını destekler.

Whisper için ortam değişkenleri:

```powershell
$env:CIRAK_WHISPER_SCRIPT="C:\path\to\whisper_capture.py"
$env:CIRAK_PYTHON="python"
```

Script, mikrofon kaydını alıp Türkçe transkripsiyonu stdout'a yazmalıdır.

İsteğe bağlı alternatif:

```powershell
$env:CIRAK_STT_COMMAND="C:\path\to\stt-command.exe"
```

## 5) Video Engine

Çırak video üretiminde repo içindeki `video-engine/cirak_video_pipeline.py` dosyasını kullanır.

Gerçek AI sahne üretimi için provider anahtarlarını yerel `.env` dosyasında yapılandırın. Anahtarları GitHub'a göndermeyin.

## 6) Windows başlangıç

İlk kurulum ve test tamamlandıktan sonra Electron uygulamasının Windows başlangıcında otomatik açılması için installer/package adımına geçilebilir.
