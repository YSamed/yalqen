# 0001 — Uygulama çatısı ve UI teknolojisi

Durum: **Açık** (Faz 0'da karara bağlanacak)

## Bağlam

Sayfa motoru Chromium olarak kesinleşti. Uygulama çatısı ve arayüz teknolojisi açık karardır ([Proje planı §7](../PROJECT_PLAN.md#7-teknik-seçim--henüz-kesinleşmedi)).

## Adaylar

| Aday | Prototip |
|---|---|
| Electron + TypeScript + Svelte | [`prototypes/electron`](../../prototypes/electron) |
| Chromium/CEF + Swift/AppKit | [`prototypes/cef-appkit`](../../prototypes/cef-appkit) |

## Değerlendirme ölçütleri

1. Toplam RAM: [`bench/SCENARIO.md`](../../bench/SCENARIO.md) adımlarında.
2. Bellekten çıkarılmış sekmenin geri açılma süresi ve geçmişin geri yüklenmesi.
3. Arayüz tepki süresi (sekme seçimi, panel daralt/genişlet).
4. DevTools gömme olanağı (Faz 3 için).
5. Ortak oturum üzerinde sekmeye özel içerik kuralları uygulanabilirliği (Faz 4 için).
6. Chromium güvenlik güncellemelerinin sürdürülebilir takibi.
7. Geliştirme ve bakım maliyeti.
8. macOS sistem cam malzemesi (Liquid Glass) desteği: pencere kabuğunun arkasındaki masaüstünü gösteren sistem malzemesinin kullanılabilmesi. Yerel AppKit'te sistem bileşeniyle doğrudan yapılabileceği; Electron'da `vibrancy` seçeneğinin yalnızca klasik buzlu malzemeyi verdiği düşünülüyor. İkisi de Faz 0'da Mac üzerinde doğrulanacak. Tasarım: [`design/TOKENS.md`](../../design/TOKENS.md#cam-malzemesi-liquid-glass-varyantı).

## Ölçüm sonuçları

_Henüz yok._

## Uygulanabilirlik notları

_Henüz yok._

## Karar

_Henüz verilmedi._
