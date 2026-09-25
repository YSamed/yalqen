# Tasarım kuralları

Faz 0 arayüz taslağının temel değerleri. Taslak: [`canvas/`](canvas) (etkileşimli tasarım sayfası kaynağı). Altyapı seçiminden bağımsızdır; Electron veya AppKit uygulaması bu değerleri kullanır.

## Renkler

Az renk: gri tonları + tek vurgu rengi. Uyarı rengi yalnızca bellek hedefi uyarısında kullanılır.

| Token | Açık | Koyu | Kullanım |
|---|---|---|---|
| `bg` | `#f3f3f1` | `#1a1a19` | Pencere zemini, sekme paneli |
| `page` | `#ffffff` | `#232322` | Sayfa kartı |
| `surface` | `#ffffff` | `#2a2a28` | Aktif sekme, adres çubuğu, açılır paneller |
| `hover` | `#e8e8e5` | `#30302e` | Üzerine gelinmiş satır/düğme |
| `border` | `#e2e2de` | `#363634` | Ayırıcı çizgiler |
| `faint` | `#ededea` | `#2e2e2c` | İlerleme çubuğu zemini, segment kontrol zemini |
| `text` | `#1d1d1b` | `#ececea` | Ana metin |
| `muted` | `#66665f` | `#a3a39b` | İkincil metin, pasif ikonlar, uyuyan sekme başlığı |
| `accent` | `#2f5fd0` | `#86a6ff` | Odak halkası, canlı tut işareti, yükleme halkası |
| `accentSoft` | `#e7edfb` | `#26304a` | Vurgulu düğme zemini |
| `warn` | `#a34a06` | `#f0a35c` | Bellek hedefi uyarısı |
| `warnSoft` | `#fcefe2` | `#3a2a1a` | Uyarı kutusu zemini |

Metin kontrastı en az 4.5:1 hedeflenir (`muted` dahil).

## Yazı

- Yazı tipi: sistem fontu (`-apple-system`, SF Pro Text).
- Boyutlar: 11 px (yardımcı metin, RAM göstergesi), 12 px (ipucu, segment), 13 px (temel), 15 px (panel başlığı), 22 px (RAM toplamı).
- Kalınlık: 400 temel, 500 aktif sekme ve vurgulu düğme, 600 başlıklar.
- Sayılar: `font-variant-numeric: tabular-nums`.

## Ölçüler

| Öğe | Değer |
|---|---|
| Panel üst satırı (trafik ışıkları, geri/ileri/yenile) | 44 px |
| Adres çubuğu yüksekliği | 30 px |
| Sekme paneli — geniş (varsayılan) | 240 px, sürüklenerek 180–400 px |
| Sekme paneli — dar | 48 px |
| Sekme satırı | 32 px yükseklik, 2 px aralık |
| Site ikonu | 16 px |
| Araç çubuğu düğmesi | 28 px |
| Sekme satırı eylem düğmesi | 22 px |
| Boşluk ölçeği | 2, 4, 6, 8, 12, 16, 20 px |

## Pencere düzeni

Üst çubuk yoktur; sayfa pencerenin üst kenarına kadar uzanır. Pencere denetimleri sağdaki sekme panelinde toplanır:

- Geniş panel, yukarıdan aşağıya: trafik ışıkları ve geri/ileri/yenile satırı, adres çubuğu, sekmeler, en altta "Yeni sekme" satırı; alt şeritte bellek göstergesi, ayarlar ve panel düğmesi.
- Dar panel: trafik ışıkları ve gezinme düğmeleri gizlenir (kısayollar çalışır). En üstte arama düğmesi bulunur; bu düğme ya da ⌘L paneli genişletip adres çubuğuna odaklanır. Bellek göstergesi alt şeritte simge olarak kalır.

## Köşe ve gölge

- Köşe: 4 px (site ikonu), 6 px (düğme), 8 px (sekme satırı, adres çubuğu), 10 px (sayfa kartı), 12–14 px (açılır panel, ayarlar).
- Gölge (açık): `0 1px 2px rgb(0 0 0 / .06), 0 0 0 1px rgb(0 0 0 / .05)`; açılır paneller daha belirgin.
- Koyu temada gölge yerine 1 px açık kontur.

## Hareket

- Geçişler 120 ms `ease-out`; yalnızca arka plan ve renk.
- Sürekli çalışan dekoratif animasyon yok. Yükleme halkası tek yay; `prefers-reduced-motion` açıkken geçişler kapanır.

## İkonlar

16 px ızgara, 1.4 px çizgi, yuvarlak uç. Rozetlerde 9 px ikon, 12 px daire.

## Sekme durumları

Hiçbir durum yalnızca renkle anlatılmaz.

| Durum | Görsel | Renk dışı ipucu |
|---|---|---|
| Aktif | `surface` zemin + gölge, başlık 500 | Gölge ile kabarık satır; `aria-current` |
| Canlı | Normal | — |
| Uyuyan (bellekten çıkarılmış) | İkon %40 ve gri, başlık `muted` | Ay rozeti (ikonun sağ altı) |
| Canlı tutulan | Rozet `accent` | İğne rozeti (ikonun sağ üstü); geniş görünümde dolu iğne düğmesi |
| Yükleniyor | İkon çevresinde yay | Yay şekli |
| Üzerine gelinmiş | `hover` zemin | Eylem düğmeleri görünür (canlı tut, uyut, kapat) |

Dar görünümde başlık ve durum, üzerine gelindiğinde ipucu balonunda yazıyla gösterilir.

## Cam malzemesi (Liquid Glass varyantı)

Ayarlardaki "Pencere malzemesi: Opak / Cam" seçimiyle açılır. Kural: **cam yalnızca pencere kabuğunda** (sekme paneli, açılır paneller); web sayfası her zaman opak kartta kalır.

| Öğe | Koyu | Açık |
|---|---|---|
| Kabuk tonu (masaüstünün üstünde) | `rgba(28 27 40 / .55)` + blur 40 px, saturate 160 % | `rgba(246 246 248 / .58)` + aynı |
| Aktif sekme, adres çubuğu | `rgba(255 255 255 / .12)` | `rgba(255 255 255 / .72)` |
| Üzerine gelme | `rgba(255 255 255 / .07)` | `rgba(0 0 0 / .05)` |
| Metin / ikincil metin | `#f4f4f7` / `rgba(235 235 245 / .64)` | `#1c1c1e` / `rgba(40 40 45 / .72)` |
| Açılır panel | `rgba(40 39 54 / .72)` + blur 30 px | `rgba(250 250 252 / .78)` + blur 30 px |
| Sayfa kartı | `#1e1e22` (opak) | `#ffffff` (opak) |
| Pencere köşesi | 16 px, 0.5 px açık kenar parlaması | aynı |

- Uygulamada bu değerler elle çizilmez; macOS'un sistem malzemesi kullanılır. Tablodaki değerler taslaktaki CSS yaklaşımıdır.
- Sistemde "Saydamlığı azalt" açıksa opak tokenlara dönülür.
- Özel kırılma, parlama animasyonu veya sürekli efekt eklenmez (plan: yoğun görsel efektler kapsam dışı).
- Açık duvar kâğıtlarında ikincil metin kontrastı Mac'te ayrıca kontrol edilmeli.

## Taslaktaki yer tutucu değerler

RAM miktarları, bellek hedefi seçenekleri ve uyutma süreleri **örnektir**. Plan gereği gerçek değerler Faz 0 ölçümlerinden sonra belirlenecek.
