# Çırak Code Agent v0.2

Bu sürüm artık Qwen'e sadece genel soru sormaz. Workspace'i gerçekten tarar ve dosya içeriklerini okuyup Qwen'e bağlam olarak verir.

## Kurulum

Bu klasörde:

```powershell
npm install
```

Ollama'nın çalıştığını kontrol et:

```powershell
ollama list
```

Gerekirse:

```powershell
ollama serve
```

Başlat:

```powershell
npm run dev
```

Varsayılan workspace:
`C:\Users\Quantum\Desktop\cocugumla-buyuyorum-app`

Farklı workspace:

```powershell
$env:CIRAK_WORKSPACE="C:\Users\Quantum\Desktop\cocugumla-buyuyorum-app"
npm run dev
```

## Örnek

```text
analyze ActivitiesPage'deki yaş filtresini incele, ilişkili dosyaları bul ve nedenini açıkla
```

veya:

```text
analyze hayvan sesleri neden yanlış çalıyor, ilgili dosyaları tespit et ve düzeltme planı çıkar
```

`files` komutu gerçek dosya listesini gösterir.

### Güvenlik

v0.2 yalnızca okur ve analiz eder. Dosya yazma, silme veya komut çalıştırma yetkisi yoktur.

Sonraki sürüm:
- kontrollü dosya değiştirme
- git diff
- build/lint/test
- hata çıktısını Qwen'e verip otomatik düzeltme
- kullanıcı onayı
