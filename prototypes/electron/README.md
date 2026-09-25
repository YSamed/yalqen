# Electron prototipi

Faz 0 adayı: Electron + TypeScript + Svelte. Amaç ürün değil, [ölçüm senaryosunu](../../bench/SCENARIO.md) çalıştırabilecek en küçük tarayıcı.

## Çalıştırma

```sh
npm install
npm start          # derler ve uygulamayı açar
npm run typecheck  # main/preload için tsc, arayüz için svelte-check
npm test           # adres çözümleme, arama motoru ve ayar birim testleri
npm run build
```

Gereken: Node 22+. Electron ikili dosyası ilk çalıştırmada indirilir.

## Kapsam

- Sağda dikey sekme paneli: dar (ikon) ve geniş (başlık) görünüm; genişlik sol kenardan sürüklenerek 180–400 px arasında ayarlanır.
- Üst çubuk yok: trafik ışıkları, geri/ileri/yenile ve adres çubuğu panelin üstünde; toplam bellek göstergesi panelin alt şeridinde. Dar panelde trafik ışıkları ve gezinme düğmeleri gizlenir; arama düğmesi veya ⌘L paneli genişletip adres çubuğuna odaklanır.
- Sekme açma, kapatma, sürükleyerek sıralama, kapatılan sekmeyi geri açma.
- Sekmeyi bellekten çıkarma: sayfa kapatılır, gezinme geçmişi saklanır; sekme seçilince geçmişle birlikte yeniden oluşturulur. Aktif sekme bellekten çıkarılmaz.
- "Canlı tut" işareti: toplu bellekten çıkarmayı ve dondurmayı engeller.
- Arka plan sekmelerini dondurma (varsayılan açık): sekme değişince eski sekmenin sayfası dondurulur; JS, zamanlayıcılar ve animasyonlar durur, sayfa bellekte kalır. Sekme seçilince kaldığı yerden devam eder. Arka planda açılan sekmeler yüklenince dondurulur. Ses çalan, DevTools'u açık ve canlı tutulan sekmeler dondurulmaz; ses durursa veya DevTools kapanırsa dondurulur. Chromium'un DevTools protokolü (`Page.setWebLifecycleState`) üzerinden yapılır; Electron'da bunun için ayrı bir API yoktur.
- Kalıcı oturum (`persist:daily`), sekme listesinin saklanması; açılışta yalnızca aktif sekme yüklenir.
- Yeni pencere istekleri sekme olarak açılır. İzinler varsayılan olarak reddedilir (tam ekran ve pano yazma hariç).
- Sayfa çökerse sekme bellekten çıkarılmış duruma geçer; otomatik yeniden yüklenmez.
- Telefon görünümü: aktif sekme tek tuşla seçili cihazın boyutunda, çerçeve içinde gösterilir. Sayfa cihaz genişliğini, piksel yoğunluğunu, dokunma olaylarını ve mobil tarayıcı kimliğini görür. Cihazlar: iPhone 15, iPhone SE, Pixel 8, iPad mini; yatay çevrilebilir. Pencere küçükse görünüm oranlanarak küçültülür. Açıp kapatınca sayfa yeniden yüklenir (sunucu da tarayıcı kimliğini görsün diye). Sekme bazındadır ve kaydedilmez.
- Arama motoru seçimi: Google (varsayılan), Yandex, DuckDuckGo, Bing, Brave Search, Ecosia veya özel adres. Adres çubuğunun ipucu metni seçime göre değişir.
- Giriş sayfası (`yalqen://newtab/`): yeni sekmelerde açılır, çevrimdışı çalışır, adres çubuğunda boş görünür. Ortadaki "merhaba" el yazısı her uygulama açılışında ilk giriş sayfasında kendini yazar, sonrakilerde hazır görünür; "Hareketi azalt" açıksa animasyon oynamaz.
- Ayrı ayarlar penceresi (⌘, veya panel altındaki ayar düğmesi).
- Uygulama adı `yalqen` (`package.json` → `productName`), "yalqen Hakkında" penceresi. macOS menü çubuğu, Dock ve uygulama değiştirici adı çalışan paketin `Info.plist` dosyasından okur; paketlenmemiş çalıştırmada bu `node_modules` içindeki `Electron.app` olduğundan `npm start` önce [`scripts/brand-electron-mac.mjs`](scripts/brand-electron-mac.mjs) ile bu paketin adını `yalqen` yapar. `npm install` Electron'u yeniden kurarsa bir sonraki `npm start` adı tekrar ayarlar. Doğrudan `electron .` ile çalıştırılırsa ad "Electron" kalabilir.
- Uygulama ikonu [`design/brand/png/icon-512.png`](../../design/brand/png/icon-512.png): macOS'ta Dock ikonu, diğer sistemlerde pencere ikonu olarak ayarlanır.
- Cam (Liquid Glass) pencere: [tasarım kuralları](../../design/TOKENS.md#cam-malzemesi-liquid-glass). Ayrıntı aşağıda.

## Cam görünüm

macOS'ta pencere saydam açılır ve arayüzün arkasına sistem cam malzemesi yerleştirilir: macOS 26+ üzerinde `NSGlassEffectView`, daha eski sürümlerde `NSVisualEffectView`. Bunu isteğe bağlı, yalnızca macOS'a kurulan [`electron-liquid-glass`](https://github.com/Meridius-Labs/electron-liquid-glass) paketi yapar (MIT, hazır derlenmiş ikili; yalnızca açık API kullanılıyor, `unstable_*` çağrıları yok). Arayüz cam üstünde yarı saydam tokenlarla çizilir; web sayfası pencere kenarlarından 8 px içeride, 10 px köşeli opak kartta kalır.

Opak görünüme dönülen durumlar:

- macOS dışı sistemler veya eklenti yüklenemediğinde (pencere saydam açılmaz).
- Sistemde "Saydamlığı azalt" açıksa (`nativeTheme.prefersReducedTransparency`); uygulama açıkken değişirse arayüz opak zemine geçer.

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
| ⌘, | Ayarlar |
| ⌥⌘I | Sayfa DevTools |
| ⌥⌘M | Telefon görünümü aç/kapat |
| ⇧⌥⌘M | Cihazı döndür |
| ⇧⌘M | Bellek ölçümü kaydet |

## Ayarlar

Ayarlar penceresi (⌘,) değişiklikleri hemen uygular ve `settings.json` dosyasına kaydeder:

- **Arama motoru:** listeden seçilir. "Özel" seçilince `%s` içeren bir http(s) adresi girilir (ör. `https://ornek.com/search?q=%s`); adres geçersizken uyarı gösterilir ve Google kullanılır.
- **Sekme paneli:** geniş veya dar. ⌘S ve paneldeki düğme de bu ayarı değiştirir. Panel genişliği ayrıca arayüzde saklanır.
- **Tema:** sistem, açık veya koyu. Arayüz, ayarlar penceresi ve sayfalar (`prefers-color-scheme`) birlikte değişir.

- **Bellek:** arka plan sekmelerini dondurma açık veya kapalı. Kapatılınca dondurulmuş sekmeler hemen devam eder.

Bellek hedefi ve otomatik bellekten çıkarma ayarları Faz 2 kapsamındadır.

## Ölçüm

"Ölçüm" menüsü:

- **Sayfa setini aç:** [`bench/pages.txt`](../../bench/pages.txt) içindeki adresleri arka plan sekmeleri olarak açar.
- **Arka plan sekmelerini bellekten çıkar:** Aktif ve "canlı tut" dışındaki bütün sekmeleri çıkarır.
- **Bellek baskısı sinyali gönder:** Bütün süreçlere kritik bellek baskısı bildirimi gönderir (`Memory.simulatePressureNotification`); Chromium önbellekleri bırakır ve çöp toplar. Otomatik çalışmaz; neyi geri kazandırdığını ölçmek içindir.
- **Bellek ölçümü kaydet:** Süreç bazlı bellek kaydını `bench/results/electron-YYYY-MM-DD.jsonl` dosyasına ekler (dizin `YALQEN_METRICS_DIR` ile değiştirilebilir).

Kayıtta canlı, dondurulmuş ve toplam sekme sayısı bulunur. Bellekten çıkarılmış sekmenin geri açılma süresi aynı dosyaya `"event": "restore"` olarak otomatik yazılır.

Metrik: `app.getAppMetrics()` → `workingSetSize` toplamı (tarayıcı, GPU, yardımcı süreçler, arayüz ve sayfa renderer'ları dahil). macOS'ta bu değer yerleşik bellektir ve Activity Monitor'ün "Memory" sütunundaki footprint değerinden farklıdır; sonuçlar `footprint` komutuyla çapraz kontrol edilmelidir.

## Doğrulama durumu

Linux (Xvfb) üzerinde, yerel test sayfalarıyla otomatik bir duman testi geçti: gezinme, bellekten çıkarma, geçmişle geri yükleme ve geri gitme, canlı tut, sıralama, kapat/geri aç, açılır pencerenin sekmeye dönüşmesi, ölçüm kaydı, yeniden açılışta yalnızca aktif sekmenin yüklenmesi.

Dondurma da aynı yolla denendi: dondurulan sekmede zamanlayıcı ve `requestAnimationFrame` durdu, seçilince devam etti (`freeze`/`resume` olayları geldi); canlı tut, ses çalan sekme, ayarı kapatıp açma, bellekten çıkarıp geri açma, bellek baskısı sinyali ve ölçüm kaydı çalıştı. Gerçek sitelerde ve bellek etkisi ölçülmedi.

**macOS'ta henüz çalıştırılmadı.** Pencere başlık çubuğu (`hiddenInset`), trafik ışıklarının panele taşınması (`setWindowButtonPosition`) ve kısayollar Mac'te kontrol edilmelidir. Cam görünüm de yalnızca Linux'ta, arayüzün tarayıcıda taklit edilmiş bir masaüstü üzerinde ekran görüntüsüyle kontrol edildi; Mac'te bakılacaklar: cam görünümün gelmesi, saydam pencerenin gölgesi ve yeniden boyutlandırılması, sayfa kartının köşeleri, "Saydamlığı azalt" değişince opak zemine geçiş, açık duvar kâğıtlarında ikincil metin kontrastı. Linux'ta alınan bellek sayıları karar için kullanılmaz.

Veri dizini: `~/Library/Application Support/yalqen-electron-prototype` (macOS).
