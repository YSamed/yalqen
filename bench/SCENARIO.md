# Faz 0 ölçüm senaryosu

Her iki aday (Electron, CEF + AppKit) aynı senaryoyla ölçülür. Kaynak: [Proje planı §9](../docs/PROJECT_PLAN.md#9-ölçüm-ve-kalite-yaklaşımı).

## Kayıt edilecek ortam bilgisi

| Alan | Değer |
|---|---|
| Mac modeli / çip | |
| Fiziksel RAM | |
| macOS sürümü | |
| Aday ve sürümü | |
| Chromium sürümü | |
| Derleme türü | debug / release |
| Tarih | |

## Sayfa seti

Açık soru (§11): kesin set günlük kullanıma göre belirlenecek. Geçici set aşağıdadır; prototiplerin okuduğu kaynak [`pages.txt`](pages.txt) dosyasıdır.

1. `https://example.com` — statik, çok küçük
2. `https://en.wikipedia.org/wiki/Chromium_(web_browser)` — metin ağırlıklı
3. `https://github.com/electron/electron` — orta ağırlıklı web uygulaması
4. `https://www.youtube.com` — medya ağırlıklı
5. `https://news.ycombinator.com` — hafif liste
6. `https://developer.mozilla.org/en-US/docs/Web/JavaScript` — dokümantasyon
7. `https://www.reddit.com` — ağır ve dinamik
8. `https://maps.google.com` — harita, yoğun JS
9. `https://docs.google.com` — giriş gerektirebilir; oturum durumu testi
10. `https://twitter.com` — sonsuz akış

## Adımlar

S0–S2 dondurma kapalıyken ölçülür (Electron: Ayarlar → Bellek). S2F ve S2P yalnızca dondurmanın ve bellek baskısı sinyalinin etkisini ayırmak içindir; S3–S5 yine dondurma kapalıyken ölçülür. Her adım arasında sabit **30 sn** beklenir; her ölçüm **3 kez** tekrarlanır, medyan raporlanır.

| # | Durum | Ölçüm |
|---|---|---|
| S0 | Uygulama boşta, tek boş sekme | `idle` |
| S1 | Setin ilk 5 sayfası canlı | `live-5` |
| S2 | 10 sayfanın tamamı canlı | `live-10` |
| S2F | S2'den sonra dondurma açılır; aktif sekme hariç hepsi dondurulmuş | `frozen-9` |
| S2P | S2F'den sonra bellek baskısı sinyali gönderilir | `frozen-9-pressure` |
| S3 | S2'den sonra aktif sekme hariç hepsi bellekten çıkarılmış | `discarded-9` |
| S4 | S3'ten sonra 3 numaralı sekme seçilir | `restore-1` + geri açılma süresi |
| S5 | 50 kayıtlı, yalnızca 1'i canlı sekme ile açılış | `cold-50` |

## Metrikler

- **Toplam bellek:** Uygulamaya ait tüm süreçlerin toplamı. Metriğin adı (ör. private / footprint / RSS) sonuçla birlikte yazılır.
- **macOS karşılaştırması:** Activity Monitor "Memory" sütunu ve `footprint` komutu ile çapraz kontrol.
- **Geri açılma süresi:** Sekme seçiminden `did-finish-load` (veya adayın eşdeğeri) olayına kadar geçen süre.
- **Arka plan CPU:** S2, S2F ve S3'te 60 sn boyunca ortalama CPU.
- **Arayüz tepki süresi:** Sekme paneli daralt/genişlet ve sekme seçimi; girdi olayından ilk kareye kadar.

JavaScript heap tek başına RAM olarak raporlanmaz. macOS bellek sıkıştırması sonuçları etkileyebilir; ölçüm öncesi makinede başka ağır uygulama çalıştırılmaz.

## Sonuç tablosu

| Adım | Electron | CEF + AppKit |
|---|---|---|
| idle | | |
| live-5 | | |
| live-10 | | |
| frozen-9 | | |
| frozen-9-pressure | | |
| discarded-9 | | |
| restore-1 (MB / ms) | | |
| cold-50 | | |

Ham sonuçlar `bench/results/` altına yazılır (depoya eklenmez); özetlenmiş tablo karar belgesine taşınır.
