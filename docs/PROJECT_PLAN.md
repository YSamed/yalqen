# RAM Odaklı Chromium Tarayıcı — Proje Planı

Tarih: 25 Eylül 2026  
Durum: Ürün planı; geliştirme başlamadı

## 1. Ürün hedefi

macOS için Chromium tabanlı, çok sayıda sekmeyi düşük bellek maliyetiyle saklayabilen kişisel bir tarayıcı geliştirmek.

Görsel yön: Dia gibi sade bir arayüz. Etkileşim hedefi: Zed gibi hızlı ve doğrudan tepki veren kontroller. Sekmeler sağda, dar veya geniş görünümde yer alacak.

“Zed kadar hızlı” ifadesi arayüz için bir tasarım ve ölçüm hedefidir; henüz doğrulanmış bir performans iddiası değildir. İnternet hızı ve uyutulmuş sayfanın yeniden yüklenmesi ayrı değerlendirilir.

Öncelik sırası:

1. Düşük RAM kullanımı.
2. Güvenilir günlük kullanım ve çalışma durumunun korunması.
3. Hızlı, özenli ve sade arayüz.
4. Esnek yapı ve sonradan eklenebilen modlar.
5. Geliştirici araçları ve ek özellikler.

## 2. Kesinleşen kararlar

| Konu | Karar |
|---|---|
| Platform | Yalnızca macOS |
| Kullanım | Kişisel kullanım; ilk kapsamda dağıtım ve notarization yok |
| Sayfa motoru | Chromium; WebKit kullanılmayacak |
| İlk ürün | Normal kullanım ve RAM yönetimi tamamlanmış temel tarayıcı |
| Modların sırası | Normal → Dev → Eco |
| Sekme düzeni | Sağda dikey sekmeler |
| Panel görünümleri | Dar ikon görünümü ve geniş başlık görünümü |
| Görsel yaklaşım | Dia benzeri sadelik, az renk ve az görünür kontrol |
| Geliştirme yaklaşımı | Fazlar halinde; çıkış koşulları sağlanmadan sonraki moda geçilmez |
| Uygulama boyutu | RAM'e göre ikincil önemde |

## 3. Arayüz planı

### Sağ sekme paneli

- Dar görünümde site ikonları gösterilir; üzerine gelindiğinde başlık görünür.
- Geniş görünümde site ikonu, başlık, kapatma kontrolü ve sekme durumu bulunur.
- Panel düğme veya klavye kısayoluyla daraltılıp genişletilir.
- Geniş panelin boyutu belirlenen sınırlar içinde sürüklenerek ayarlanabilir.
- Üzerine gelmek paneli otomatik genişletmez.
- Aktif sekme açıkça ayırt edilir.
- Bellekten çıkarılmış sekmeler soluk görünür; durum yalnızca renge bağlı anlatılmaz.
- “Canlı tut” işaretli sekmelerin koruma durumu görülebilir.

### Diğer kontroller

- Sekme panelinin üstünde kompakt adres çubuğu; geri, ileri ve yenile kontrolleri. Ayrı bir üst çubuk yoktur.
- Gerektiğinde açılan sade ayarlar paneli.
- Küçük toplam RAM göstergesi; ayrıntılar talep edildiğinde açılır.
- Tutarlı yazı boyutları, boşluklar, ikonlar, odak ve hover durumları.
- Klavyeyle temel işlemlere erişim.
- Kısa ve işlemleri bekletmeyen geçişler; sürekli çalışan dekoratif animasyonlar kullanılmaz.

İlk sürümde yatay sekmeler bulunmaz. Ayrıntılı tema seçenekleri ve görsel kişiselleştirme sonraya bırakılır.

## 4. Bellek yaklaşımı

### Sekme ile çalışan sayfa ayrımı

Sekmenin listede bulunması, sayfanın bellekte çalışması anlamına gelmez. Bellekten çıkarılmış sekmenin gerekli kayıtları tutulur; sayfa seçildiğinde yeniden oluşturulur.

Temel işlemler:

- Uygun arka plan sekmelerini otomatik olarak bellekten çıkarma.
- Kullanıcının istediği sekmeyi hemen bellekten çıkarabilmesi.
- “Canlı tut” ile otomatik çıkarmadan koruma.
- Uygulama açılışında sekme listesini geri getirip yalnızca seçili sayfayı yükleme.
- Gezinme geçmişini ve mümkün olduğu ölçüde sayfa durumunu geri yükleme.

Bir sekmeyi kapatmak veya bellekten çıkarmak, ona atfedilen bütün belleğin anında geri alınacağını garanti etmez. Sonuç toplam uygulama ölçümleriyle doğrulanır.

### Bellek hedefi

Kullanıcı bir bellek hedefi belirleyebilir. Bu kesin bir üst sınır değildir. Hedef aşıldığında uygun sekmeler arasından uzun süredir kullanılmayanlar seçilir.

Aktif ve korunmuş sekmeler tek başına hedefi aşarsa kullanıcıya durum gösterilir; bu sekmeler zorla kapatılmaz. Sabit “en fazla üç canlı sekme” kuralı henüz kabul edilmiş değildir. Süreler ve canlı sekme bütçesi ölçümlere göre belirlenecektir.

### Koruma ve geri yükleme

- Aktif sekme otomatik olarak bellekten çıkarılmaz.
- “Canlı tut” işaretli sekmeler korunur.
- Dev modu geldiğinde Dev sekmeleri otomatik olarak çıkarılmaz.
- Medya oynatma, görüşme, yükleme ve kaydedilmemiş çalışma senaryoları koruma testlerine alınır.
- Bütün çalışma durumlarının otomatik ve kusursuz algılanacağı vaat edilmez; manuel koruma her zaman bulunur.
- Geçmiş, form ve kaydırma konumu geri yükleme en iyi çaba yaklaşımıdır; her web uygulamasının tüm iç durumunu koruma garantisi verilmez.

## 5. Modlar

İlk sürüm yalnızca Normal davranışı sunar. Mod seçici ikinci mod eklendiğinde görünür hale gelir.

| Mod | Amaç | Davranış |
|---|---|---|
| Normal | Güvenilir günlük kullanım | Site işlevlerini korur; uygun arka plan sekmeleri otomatik uyutulur |
| Dev | Web geliştirme | Ayrı kalıcı oturum; otomatik uyutma ve içerik engelleme yok; geliştirici araçları isteğe bağlı açılır |
| Eco | Ek tasarruf | Daha erken uyutma; site bazında isteğe bağlı görsel, medya ve JavaScript kısıtlamaları |

JavaScript'i kapatma Eco'nun zorunlu varsayılanı değildir. Agresif tasarruf seçeneği olarak değerlendirilir.

Normal ve Eco ortak günlük oturumu kullanır. Dev ayrı oturum kullanır. Mod geçişinin sayfa yeniden yükleme ve giriş durumu üzerindeki etkisi uygulamada açıkça gösterilir.

Reklam engelleme ilk temel sürüme dahil değildir. Faz 4'te Normal ve Eco için eklenmesi, Dev'de kapalı kalması planlanır. İlk yaklaşım gömülü filtre listesi ve manuel güncellemedir; motor seçimi açıktır.

## 6. Esneklik ve mimari sınırlar

Kuralların önceliği:

1. Sekmeye özel tercih.
2. Siteye özel kural.
3. Genel varsayılan.

Başlangıçtan itibaren sorumluluklar ayrılır:

| Bileşen | Sorumluluk |
|---|---|
| Sekme yönetimi | Açma, kapatma, sıralama, geçmiş ve yeniden oluşturma |
| Bellek politikası | Uyutma adayları, süreler, koruma ve bellek hedefi |
| Mod kuralları | İçerik izinleri, oturum seçimi ve mod istisnaları |
| Oturum yönetimi | Kalıcı girişler ve site verileri |
| Arayüz | Sekme paneli, adres çubuğu ve ayarlar |
| Ölçüm | Toplam kaynak kullanımı ve etkileşim süreleri |

Esneklik için ilk sürümde genel amaçlı bir eklenti sistemi kurulmaz. Altyapı değiştirmenin maliyetsiz olacağı varsayılmaz; amaç temel iş kurallarını mümkün olduğunca arayüz ve motor bağlantısından ayırmaktır.

## 7. Teknik seçim — henüz kesinleşmedi

Chromium kararı kesindir; uygulama çatısı ve UI teknolojisi açık karardır.

| Aday | Güçlü taraf | Değerlendirilecek bedel |
|---|---|---|
| Electron + TypeScript + Svelte | Hızlı geliştirme, esnek arayüz | Web tabanlı uygulama arayüzünün taban kaynak maliyeti |
| Chromium/CEF + Swift/AppKit | Yerel macOS arayüzü, UI için ayrı web katmanı gerektirmemesi | Motor köprüsü, sekme yaşam döngüsü, DevTools ve bakım zorluğu |

Rust/GPUI araştırılmış bir alternatiftir; ilk karşılaştırmanın kapsamına alınmaz. Zed'in performansı Chromium entegrasyonuna doğrudan aktarılabilir kabul edilmez.

Faz 0'da aynı küçük senaryoyla iki aday değerlendirilir. Yerel arayüzün otomatik olarak daha az toplam RAM kullanacağı varsayılmaz. Karar ölçümler ve geliştirme/bakım maliyeti birlikte görülerek verilir.

## 8. Fazlar ve çıkış koşulları

### Faz 0 — Tasarım ve teknik doğrulama

Kapsam:

- Sağ panelin dar ve geniş durumlarını, adres çubuğunu ve temel ayarları gösteren UI taslağı.
- Electron ve yerel arayüz + CEF için sınırlı teknik denemeler.
- Aynı sayfa setinde boşta, canlı sekmelerle ve bellekten çıkarma sonrasında ölçüm.
- Sayfayı yeniden oluşturma, geçmişi geri yükleme ve ileride DevTools gömme olanağını doğrulama.
- Ortak oturum üzerinde sekmeye özel içerik kurallarının uygulanabilirliğini sınırlı deneyle kontrol etme.

Çıkış koşulu: Görsel yön netleşmiş; altyapı seçimi ölçüm ve uygulanabilirlik notuyla belgelenmiş; sayısal performans kabul hedefleri belirlenmiş.

### Faz 1 — Güvenilir temel tarayıcı

Kapsam:

- Sağda dar/geniş dikey sekmeler.
- Adres çubuğu, geri/ileri ve yenileme.
- Sekme açma, kapatma, sıralama ve kapatılan sekmeyi geri açma.
- Kalıcı günlük oturum.
- Sekme listesini saklama ve uygulama yeniden açıldığında kurtarma.
- Temel klavye ve odak davranışları.
- Web içeriği ile uygulama yetkilerinin ayrılması; izin ve yeni pencere davranışlarının tanımlanması.

Çıkış koşulu: Belirlenen günlük gezinme senaryoları geçiyor; giriş ve sekme kayıtları güvenilir; engelleyici sorun yok.

### Faz 2 — RAM odaklı Normal mod

Kapsam:

- Otomatik ve manuel bellekten çıkarma.
- “Canlı tut” ve koruma kuralları.
- Bellek hedefi ve toplam RAM göstergesi.
- Açılışta yalnızca seçili sayfayı yükleme.
- Geri yükleme, hata ve çökme durumlarının ele alınması.

Çıkış koşulu: Gerçek kullanım setinde tasarruf doğrulanmış; geri dönüş süreleri kabul hedeflerini sağlıyor; koruma testleri geçiyor; sürekli yeniden yükleme döngüsü oluşmuyor.

**İlk tamamlanmış kullanılabilir sürüm Faz 2 sonunda oluşur.** Sonraki moda geçmeden önce günlük kullanım değerlendirmesi yapılır.

### Faz 3 — Dev modu

Kapsam:

- Ayrı kalıcı geliştirme oturumu.
- Otomatik uyutma dışında tutma.
- İsteğe bağlı açılan gömülü DevTools.
- Hard reload ve kapsamı açık site verisi temizleme.
- Mod göstergesi ve mod değiştirme davranışı.

Çıkış koşulu: Belirlenen geliştirme akışları tarayıcı içinde tamamlanıyor; Normal sekmelerin bellek politikası bozulmuyor; oturum ayrımı doğrulanmış.

### Faz 4 — Eco ve içerik engelleme

Kapsam:

- Daha agresif uyutma politikası.
- Reklam engelleme ve site istisnaları.
- İsteğe bağlı görsel, medya ve JavaScript kısıtlamaları.
- Engellemeyi kolayca geçici kaldırma.
- Normal ve Eco'nun ortak oturumda farklı kurallarla çalışması.

Çıkış koşulu: Ek kaynak kazancı ölçülmüş; site bozulmalarından geri dönüş kolay; Dev isteklerine engelleme uygulanmıyor; ortak oturum kuralları doğru çalışıyor.

### Faz 5 — Ölçüme dayalı iyileştirmeler

Adaylar: Düzenlenebilir kısayollar, cihaz emülasyonu presetleri, ayrıntılı kaynak paneli, tema seçenekleri ve kullanım testlerinin ortaya çıkardığı iyileştirmeler.

Her özellik ayrı değerlendirilir. Bu fazdaki maddeler ilk sürüm taahhüdü değildir.

## 9. Ölçüm ve kalite yaklaşımı

- Test makinesi, macOS, motor sürümü ve yapılandırma kaydedilir.
- Aynı sayfalar, aynı işlemler ve aynı bekleme süreleriyle tekrarlı ölçüm yapılır.
- Boşta, 5 ve 10 canlı sekmeyle; çok sayıda kayıtlı fakat uyutulmuş sekmeyle ölçüm alınır.
- Toplam uygulama kaynakları izlenir; yalnızca JavaScript heap'i RAM olarak raporlanmaz.
- macOS bellek sıkıştırması ve kullanılan metriğin tanımı sonuçlarla birlikte belirtilir.
- Bellek düşüşü, geri açılma süresi, arayüz tepki süresi ve arka plan CPU kullanımı birlikte değerlendirilir.
- Sekme başına bellek gösterimi eklenirse paylaşılmış süreçler nedeniyle yaklaşık olabileceği belirtilir.
- Sayısal RAM ve gecikme hedefleri Faz 0 sonuçlarından önce uydurulmaz.

Bir fazın “tamamlanmış” olması bütün olası hataların yokluğu değil; tanımlı kabul senaryolarının geçmesi ve hedef kullanımda engelleyici sorun kalmamasıdır. Her faz sonunda değişiklikler, doğrulamalar ve kalan sınırlamalar kaydedilir.

## 10. İlk kapsam dışında

- Chrome eklentileri ve genel amaçlı eklenti altyapısı.
- Şifre yöneticisi.
- AI asistanı veya Dia'nın AI özelliklerinin kopyalanması.
- Çoklu platform desteği.
- Yatay sekmeler.
- Ayrıntılı temalar ve yoğun görsel efektler.
- Otomatik dağıtım, mağaza yayını ve notarization.

Kişisel kullanım güvenlik bakımını kapsam dışına çıkarmaz. Seçilen Chromium dağıtımının güncellenmesi için sürdürülebilir bir yol tanımlanır.

## 11. Açık sorular

- Hedef Mac'in donanımı ve RAM kapasitesi nedir?
- Gerçek kullanımda kaç sekme açık, kaçı sürekli canlı kalmalı?
- Kabul edilebilir uyutulmuş sekme geri açılma süresi nedir?
- Varsayılan panel genişliği ve ilk açılış görünümü ne olmalı?
- İlk günlük kullanım test setine hangi siteler ve iş akışları girmeli?
- İndirme, açılır pencere, dosya yükleme ve medya akışları için ilk sürüm kabul senaryoları neler olmalı?

Bu sorular taslak hazırlanmasını engellemez; ilgili uygulama kararından önce netleştirilir.

## 12. Teknik referanslar

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron gezinme geçmişi ve geri yükleme](https://www.electronjs.org/docs/latest/api/navigation-history)
- [Electron oturum bazlı ağ istekleri](https://www.electronjs.org/docs/latest/api/web-request)
- [Electron bellek ölçümleri](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)
- [Electron güvenlik yaklaşımı](https://www.electronjs.org/docs/latest/tutorial/security)
- [Arc ve Dia üzerine The Browser Company açıklaması](https://browsercompany.substack.com/p/letter-to-arc-members-2025)
- [Dia'nın Chromium temeli](https://www.diabrowser.com/security)
- [Zed'in GPUI yaklaşımı](https://zed.dev/blog/videogame)

Bu plan ilk proje özetini ve konuşmada alınan sonraki kararları birleştirir. Çelişen noktalarda konuşmada alınan son kararlar esas alınmıştır.
