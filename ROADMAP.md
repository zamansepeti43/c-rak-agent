# Çırak — Yol Haritası

## Nihai hedef

Çırak; Windows masaüstünde arka planda çalışabilen, yazılı ve sesli komut alabilen, yerel Ollama/Qwen ile karar verebilen, güvenli şekilde bilgisayarda işlem yapabilen, kod geliştirebilen ve kaliteli video üretebilen kişisel AI agent olacak.

## Faz 0 — Temel stabilizasyon
- [x] Mevcut Çırak kodunu GitHub'a taşımak
- [ ] Aktif kaynak dosyalarını belirlemek ve backup dosyalarını ayırmak
- [ ] node_modules'u repository takibinden çıkarmak
- [ ] .gitignore oluşturmak
- [ ] package/version/sürüm bilgisini tekilleştirmek
- [ ] typecheck/build/test akışını güvenilir hale getirmek
- [ ] Workspace ve araç izinlerini merkezi hale getirmek

## Faz 1 — Çırak Agent Core
- [ ] Araç çağrı protokolünü sağlamlaştırmak
- [ ] Plan → uygulama → doğrulama döngüsünü kurmak
- [ ] Hata kurtarma ve tekrar önleme mekanizmasını güçlendirmek
- [ ] İşlem kayıtları ve görev durumu
- [ ] Kalıcı hafıza katmanı
- [ ] Kullanıcı onayı gerektiren riskli işlemler için approval sistemi

## Faz 2 — Video Engine 1.0
- [ ] Mevcut VIDEO-SISTEMI/render_story.py sistemini repository'ye almak
- [ ] Video workspace'i hardcoded olmaktan çıkarmak
- [ ] Konu → senaryo pipeline'ı
- [ ] Senaryo → storyboard/sahne planı
- [ ] Karakter ve görsel sürekliliği
- [ ] Görsel/video üretim adaptörleri
- [ ] Türkçe TTS
- [ ] Müzik ve ses efektleri
- [ ] Türkçe karakter uyumlu altyazı
- [ ] FFmpeg final render
- [ ] 16:9 ve 9:16 çıktılar
- [ ] Render doğrulama ve başarısız sahne recovery
- [ ] Tek komutla kaliteli MP4 üretimi

## Faz 3 — Çırak Desktop
- [ ] Windows masaüstü uygulaması
- [ ] System tray
- [ ] Çırak paneli
- [ ] Açılışta otomatik başlatma seçeneği
- [ ] Agent servis yaşam döngüsü
- [ ] Workspace seçimi
- [ ] Ollama durum göstergesi
- [ ] Video üretim durumu/progress

## Faz 4 — Sesli Çırak
- [ ] Mikrofon izin yönetimi
- [ ] Speech-to-Text
- [ ] Türkçe konuşma tanıma
- [ ] Text-to-Speech
- [ ] Türkçe doğal ses
- [ ] Konuşma geçmişi
- [ ] "Çırak" wake-word/uyandırma katmanı
- [ ] Dinliyor/işliyor/konuşuyor durumları
- [ ] Sesli komutların aynı agent araçlarına bağlanması

## Faz 5 — Bilgisayar kontrolü
- [ ] Uygulama açma/kapama
- [ ] Klasör ve dosya işlemleri
- [ ] Tarayıcı açma ve kontrollü web görevleri
- [ ] Ekran görüntüsü/ekran bağlamı
- [ ] Klavye/fare otomasyonu için izinli araç katmanı
- [ ] Riskli işlemlerde sesli/yazılı onay
- [ ] Denetim günlüğü

## Faz 6 — Jarvis deneyimi
- [ ] Tek merkezden ses + chat + görevler
- [ ] Görev kuyruğu
- [ ] Arka planda çalışan agent
- [ ] Bildirimler
- [ ] Hatırlatıcılar
- [ ] Uzun süren görevlerde durum güncellemeleri
- [ ] "Ben hallediyorum" tipi görev akışı
- [ ] Açılışta Çırak hazır durumu

## Faz 7 — Kalite ve paketleme
- [ ] Otomatik testler
- [ ] Video pipeline testleri
- [ ] Ses pipeline testleri
- [ ] Güvenlik denetimi
- [ ] Windows installer
- [ ] Güncelleme mekanizması
- [ ] Kurulum sonrası tek komutla hazır sistem

## Uygulama sırası

1. Faz 0 stabilizasyon
2. Faz 1 Agent Core
3. Faz 2 Video Engine 1.0
4. Faz 3 Desktop
5. Faz 4 Voice
6. Faz 5 Computer Control
7. Faz 6 Jarvis deneyimi
8. Faz 7 paketleme/kalite

## İlk milestone

**Milestone A — Çırak 0.6:**
Agent Core + güvenli araçlar + stabil çalışma + video pipeline entegrasyonu.

**Milestone B — Çırak 0.7:**
Windows Desktop + tray + chat.

**Milestone C — Çırak 0.8:**
STT + TTS + sesli komut.

**Milestone D — Çırak 0.9:**
Bilgisayar kontrolü + approval sistemi.

**Milestone E — Çırak 1.0:**
Jarvis deneyimi + kaliteli video üretimi + kalıcı hafıza + Windows installer.
