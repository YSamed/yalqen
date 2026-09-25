# Electron prototipi

Faz 0 adayı: Electron + TypeScript + Svelte. Amaç ürün değil, [ölçüm senaryosunu](../../bench/SCENARIO.md) çalıştırabilecek en küçük tarayıcı.

## Çalıştırma

```sh
npm install
npm start          # derler ve uygulamayı açar
npm run typecheck  # main/preload için tsc, arayüz için svelte-check
npm test           # adres çözümleme ve arama motoru birim testleri
npm run build
```

Gereken: Node 22+. Electron ikili dosyası ilk çalıştırmada indirilir.

## Kapsam

- Sağda dikey sekme paneli: dar (ikon) ve geniş (başlık) görünüm; genişlik sol kenardan sürüklenerek 180–400 px arasında ayarlanır.
- Adres çubuğu, geri/ileri/yenile, toplam bellek göstergesi.
- Sekme açma, kapatma, sürükleyerek sıralama, kapatılan sekmeyi geri açma.
- Sekmeyi bellekten çıkarma: sayfa kapatılır, gezinme geçmişi saklanır; sekme seçilince geçmişle birlikte yeniden oluşturulur. Aktif sekme bellekten çıkarılmaz.
- "Canlı tut" işareti (Faz 0'da yalnızca toplu bellekten çıkarmayı etkiler).
- Kalıcı oturum (`persist:daily`), sekme listesinin saklanması; açılışta yalnızca aktif sekme yüklenir.
- Yeni pencere istekleri sekme olarak açılır. İzinler varsayılan olarak reddedilir (tam ekran ve pano yazma hariç).
- Sayfa çökerse sekme bellekten çıkarılmış duruma geçer; otomatik yeniden yüklenmez.
- Arama motoru seçimi: Google (varsayılan), Yandex, DuckDuckGo, Bing, Brave Search, Ecosia veya özel adres. Adres çubuğunun ipucu metni seçime göre değişir.
- Uygulama ikonu [`design/brand/png/icon-512.png`](../../design/brand/png/icon-512.png): macOS'ta Dock ikonu, diğer sistemlerde pencere ikonu olarak ayarlanır.

Otomatik bellekten çıkarma ve bellek hedefi Faz 2 kapsamındadır; burada yoktur.

## Kısayollar

| Kısayol | İşlem |
|---|---|
| ⌘T / ⌘W | Yeni sekme / sekmeyi kapat |
| ⇧⌘T | Kapatılan sekmeyi aç |
| ⌘L | Adres çubuğu |
| ⌘R | Yenile |
| ⌘[ / ⌘] | Geri / ileri |
| ⌘1…⌘8, ⌘9 | Sekme seç, son sekme |
| ⌘S | Sekme panelini daralt/genişlet |
| ⌥⌘I | Sayfa DevTools |
| ⇧⌘M | Bellek ölçümü kaydet |

## Ayarlar

Ayarlar penceresi henüz yok (tasarım prototipe uygulanırken eklenecek). Şimdilik:

- **Ayarlar → Arama motoru** menüsünden seçim yapılır; seçim `settings.json` dosyasına kaydedilir.
- **Özel arama motoru:** Ayarlar → Ayar dosyasını aç ile `settings.json` açılır, `customSearchTemplate` alanına `%s` içeren bir http(s) adresi yazılır (ör. `"https://ornek.com/search?q=%s"`), uygulama yeniden başlatılınca menüde "Özel" seçilebilir. Geçersiz adreste Google kullanılır.

## Ölçüm

"Ölçüm" menüsü:

- **Sayfa setini aç:** [`bench/pages.txt`](../../bench/pages.txt) içindeki adresleri arka plan sekmeleri olarak açar.
- **Arka plan sekmelerini bellekten çıkar:** Aktif ve "canlı tut" dışındaki bütün sekmeleri çıkarır.
- **Bellek ölçümü kaydet:** Süreç bazlı bellek kaydını `bench/results/electron-YYYY-MM-DD.jsonl` dosyasına ekler (dizin `YALQEN_METRICS_DIR` ile değiştirilebilir).

Bellekten çıkarılmış sekmenin geri açılma süresi aynı dosyaya `"event": "restore"` olarak otomatik yazılır.

Metrik: `app.getAppMetrics()` → `workingSetSize` toplamı (tarayıcı, GPU, yardımcı süreçler, arayüz ve sayfa renderer'ları dahil). macOS'ta bu değer yerleşik bellektir ve Activity Monitor'ün "Memory" sütunundaki footprint değerinden farklıdır; sonuçlar `footprint` komutuyla çapraz kontrol edilmelidir.

## Doğrulama durumu

Linux (Xvfb) üzerinde, yerel test sayfalarıyla otomatik bir duman testi geçti: gezinme, bellekten çıkarma, geçmişle geri yükleme ve geri gitme, canlı tut, sıralama, kapat/geri aç, açılır pencerenin sekmeye dönüşmesi, ölçüm kaydı, yeniden açılışta yalnızca aktif sekmenin yüklenmesi.

**macOS'ta henüz çalıştırılmadı.** Pencere başlık çubuğu (`hiddenInset`), trafik ışıkları boşluğu ve kısayollar Mac'te kontrol edilmelidir. Linux'ta alınan bellek sayıları karar için kullanılmaz.

Veri dizini: `~/Library/Application Support/yalqen-electron-prototype` (macOS).
