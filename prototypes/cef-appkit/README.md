# CEF + Swift/AppKit prototipi

Faz 0 adayı: Chromium Embedded Framework (CEF) + yerel macOS arayüzü. Bu dizinde henüz kod yok; bu belge Mac'te yapılacak kurulumu ve Electron prototipiyle aynı senaryoyu karşılamak için gereken işleri tanımlar.

Kod yazılmamasının nedeni: CEF + AppKit yalnızca macOS'ta Xcode ile derlenebilir. İlk iskelet Mac üzerinde kurulup doğrulanacak.

## Gereksinimler

- macOS, Xcode (komut satırı araçlarıyla), CMake 3.21+.
- CEF ikili dağıtımı: <https://cef-builds.spotifycdn.com/index.html> → macOS ARM64 (veya x64), "Standard Distribution".
- Chromium sürümü Electron prototipindekine (şu an Chromium 152) mümkün olduğunca yakın seçilir; ölçüm kaydına yazılır.

## Kurulum adımları

1. CEF dağıtımını indirip `prototypes/cef-appkit/third_party/cef/` altına açmak (`.gitignore` ile depo dışında tutulur).
2. Dağıtımdaki `cefsimple` örneğini CMake ile derleyip çalıştırarak araç zincirini doğrulamak.
3. `cefsimple` temel alınarak Objective-C++ köprüsü (`.mm`) + Swift/AppKit arayüzüyle uygulama iskeleti kurmak.
4. Uygulama paketinde yardımcı süreç paketlerinin (`Helper`, `Helper (GPU)`, `Helper (Renderer)` …) doğru yerleştirildiğini doğrulamak.
5. Uygulama ikonunu [`design/brand/png/`](../../design/brand/png) PNG'lerinden `iconutil` ile `.icns` olarak üretip paketin `Info.plist` dosyasına bağlamak.

## Electron prototipiyle eşleşmesi gereken kapsam

| İşlem | CEF karşılığı | Not |
|---|---|---|
| Sayfa görünümü | `CefBrowserView` / `CefBrowserHost::CreateBrowser` + `NSView` alt görünümü | |
| Sağ sekme paneli, adres çubuğu | AppKit (`NSSplitView`, `NSTableView` veya SwiftUI) | Dar/geniş görünüm |
| Sekmeyi bellekten çıkarma | `CefBrowserHost::CloseBrowser` | |
| Gezinme geçmişini okuma | `CefBrowserHost::GetNavigationEntries` | |
| **Geçmişi geri yükleme** | **Doğrudan genel API yok (doğrulanacak)** | Aşağıdaki riske bakın |
| Kalıcı oturum | `CefRequestContext` + `cache_path` | |
| Yeni pencere → sekme | `CefLifeSpanHandler::OnBeforePopup` | |
| İzin istekleri | `CefPermissionHandler` | |
| Çökme | `CefRequestHandler::OnRenderProcessTerminated` | Yeniden yükleme döngüsü olmamalı |
| DevTools gömme | `CefBrowserHost::ShowDevTools` (gömülü `CefWindowInfo`) | Faz 3 için |
| Toplam bellek | Uygulama ve yardımcı süreç PID'leri üzerinden `proc_pid_rusage` / `footprint` | CEF'te `getAppMetrics` eşdeğeri yok |

## Doğrulanması gereken riskler

1. **Geçmişin geri yüklenmesi:** Electron `navigationHistory.restore()` sunar. CEF'in genel API'sinde gezinme girdilerini geri yükleme bulunmadığı düşünülüyor. Seçenekler: yalnızca son adresi yükleme (geri/ileri kaybolur), CEF'e yama, veya geçmişi uygulama içinde tutup kendi geri/ileri mantığını yazma. Faz 0'da ilk iş olarak doğrulanacak.
2. **Oturum ve sekmeye özel kurallar:** Ortak `CefRequestContext` üzerinde sekme bazında içerik kuralı (Faz 4) uygulanabilirliği `CefResourceRequestHandler` ile denenmeli.
3. **Bakım:** CEF sürümleri Chromium'u takip eder; güncelleme yolu (ikili dağıtım indirme + yeniden derleme) belgelenmeli.
4. **Swift ↔ C++ köprüsü:** Objective-C++ katmanının boyutu ve bakım yükü not edilmeli.

## Sonuçların yazılacağı yer

- Ölçümler: [`bench/SCENARIO.md`](../../bench/SCENARIO.md) sonuç tablosu.
- Uygulanabilirlik notları ve karar: [`docs/decisions/0001-ui-stack.md`](../../docs/decisions/0001-ui-stack.md).
