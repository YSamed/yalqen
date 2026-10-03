# Yalqen Developer Mode: Yol Haritası

[English](developer-mode-roadmap.md)

Durum: taslak · Tarih: 2026-10-03 · Kapsam: `apps/browser`

## 1. Özet

Developer Mode, Yalqen'i developer'ın kullandığı coding agent'a (Claude Code, Codex, Cursor ve MCP destekleyen diğerleri) bağlayan bir köprüdür. Agent kaynak kodu görür ama tarayıcıda ne olduğunu göremez. Yalqen bu bilgiyi agent'a verir: seçilen element, component ve kaynak dosya, console hataları, network istekleri, ekran görüntüsü ve olayların zaman sırası.

Temel ilke:

```
Developer ne istediğini söyler.
Agent kodu değiştirir.
Yalqen çalışan uygulamanın context'ini sağlar.
```

Yalqen'in içine AI modeli, chat paneli ya da ücretli servis eklenmez. Yalqen yalnızca tarayıcının bildiğini paylaşır.

## 2. Konum ve farklılaşma

"Element seç, agent'a gönder" 2026'da yaygınlaştı: Cursor Design Mode, Codex uygulama içi browser, Claude Code desktop browser pane, VS Code integrated browser, cmux, Stagewise ve ücretsiz olarak Chrome DevTools MCP ile react-grab ikilisi. Bu araçların çoğu tek bir agent'a ya da IDE'ye bağlı.

Yalqen'in farkı dört noktada olmalı:

1. **Agent'tan bağımsız.** Standart MCP üzerinden her agent'a hizmet verir.
2. **Projede kurulum yok.** Kullanıcının uygulamasına paket, extension ya da flag eklenmez.
3. **Developer'ın günlük browser'ı.** Giriş yapılmış oturumlar, extension'lar ve gerçek sekmeler yerinde durur.
4. **Runtime Timeline.** Tıklama, istek, hata ve render tek bir zaman akışında, yerelde ve sürekli tutulur.

Her fazın sonunda şu soru yeniden sorulur: "Chrome + chrome-devtools-mcp + react-grab varken neden Yalqen?" Cevap bu dört noktaya dayanmıyorsa bir sonraki faza geçilmez.

## 3. Tasarım ilkeleri

1. **Yalqen göndermez, agent ister.** Yalqen terminale metin yazmaz. Agent ihtiyaç duyduğunda MCP üzerinden sorar. Bu yol agent güncellemelerinden etkilenmez.
2. **Varsayılan olarak kapalı, yalnızca localhost.** Özellik açılmadıkça hiçbir port dinlenmez ve hiçbir sekme izlenmez. Açıldığında yalnızca yerel geliştirme sekmeleri agent'a görünür.
3. **Ayrı bir "mod" yok.** Yalqen zaten developer'lar için bir browser. Normal ve Developer modu arasında geçiş yerine, Ayarlar → Geliştirici altında tek bir "Agent bağlantısı" anahtarı bulunur.
4. **Mevcut altyapı kullanılır.** CDP bağlantısı (`src/main/devtools/page-debugger.ts`), request kuralları (`src/main/devtools/request-rules.ts`), console hata sayacı (`src/main/tabs/tabs.ts`) ve safeStorage şifrelemesi (`src/main/privacy/password-handlers.ts`) zaten var.
5. **Veri makineden çıkmaz.** Toplanan her şey bellekte tutulur, diske yazılmaz ve sekme kapanınca silinir. Yalqen bu özellik için dışarıya istek atmaz.
6. **Her faz tek başına kullanılabilir olur.** Her faz sonunda yayınlanabilir bir parça ve ölçülebilir bir çıkış kriteri bulunur.
7. **Taşınabilir çekirdek.** CDP mesajlarını işleyen mantık saf fonksiyonlar olarak yazılır. Böylece olası bir CEF + AppKit geçişinde (bkz. [why-electron.md](decisions/why-electron.md)) Electron'a bağlı kısım ince kalır.

## 4. Fazlara genel bakış

Süreler tek kişilik geliştirme için kaba tahminlerdir.

| Faz | Ad                           | Kullanıcının kazandığı                                             | Süre      |
| --- | ---------------------------- | ------------------------------------------------------------------ | --------- |
| 0   | Hazırlık ve ölçüm            | Henüz bir şey yok; kararlar ve başlangıç ölçümleri                 | 1 hafta   |
| 1   | Agent köprüsü (salt okuma)   | "Son hatayı incele" demek yeterli; agent console ve network'ü okur | 2–3 hafta |
| 2   | Element seçici               | Elemente tıkla, agent'a "bunu düzelt" de                           | 2 hafta   |
| 3   | Component ve kaynak eşleme   | Seçim React component'ine ve `dosya:satır` bilgisine bağlanır      | 3–4 hafta |
| 4   | Runtime Timeline             | "Butona bastıktan sonra ne oldu?" sorusu tek yerde cevaplanır      | 3–4 hafta |
| 5   | Agent eylemleri ve doğrulama | Agent akışı tekrar oynatır ve düzeltmeyi kendisi doğrular          | 3 hafta   |
| 6   | Koşullu backlog              | Metrikler izin verirse genişleme                                   | —         |

Karar noktaları Faz 0, 2, 3 ve 4'ün sonundadır (bkz. bölüm 8).

## 5. Fazlar

### Faz 0: Hazırlık ve ölçüm (1 hafta)

**Amaç:** Problemi kendi kullanımında ölçmek, teknik kararları kayda geçirmek.

**Yapılacaklar**

- Bir hafta boyunca agent'a context anlatırken bunu not et: neyi kopyaladın (console, network response, element, ekran görüntüsü), ne kadar sürdü, agent yanlış dosyaya kaç kez gitti. Bu başlangıç ölçümü olur.
- Aynı işleri rakip araçlarla dene: Chrome + chrome-devtools-mcp + react-grab ve Claude Code desktop browser pane. Her birinde yaşadığın zorlukları listele.
- `docs/decisions/agent-bridge.md` karar kaydını yaz:
  - Transport: `127.0.0.1` üzerinde Streamable HTTP MCP. Yalqen bir GUI uygulaması olduğu için agent'ın başlatacağı stdio süreci uygun değil. Electron fuse'ları `runAsNode`'u kapattığı için ayrı bir Node süreci de çalıştırılamıyor.
  - Bağımlılıklar: çalışma zamanında MCP SDK yok; `node:http` üzerinde küçük bir JSON-RPC sunucusu. SDK yalnızca uçtan uca testler için dev bağımlılığı (bkz. [agent-bridge.md](decisions/agent-bridge.md)).
  - Port: sabit bir varsayılan port, doluysa sıradaki boş port. Seçilen port ayarlarda gösterilir.
- Adlandırma: CLI, tool ve belgelerde her yerde `yalqen` kullanılır (`yalken` değil).
- Test için örnek uygulamalar hazırla: Next.js (App Router, Turbopack), Vite + React 19, webpack + React 18. Bu uygulamalar ayrı bir depoda tutulur, Yalqen CI'ını yavaşlatmaz.

**Çıkış kriterleri**

- Başlangıç ölçümleri yazılı.
- Karar kaydı birleştirilmiş.
- Örnek uygulamalar çalışıyor ve her birinde bilinçli olarak yerleştirilmiş bir hata var: 500 dönen bir API, bir `TypeError` ve mobilde taşan bir buton.

### Faz 1: Agent köprüsü, salt okuma (2–3 hafta)

**Amaç:** Agent'ın localhost sekmelerindeki console, network ve sayfa bilgisini okuyabilmesi. Hata senaryosu bu fazla birlikte uçtan uca çalışır.

**Kullanıcı deneyimi**

1. Ayarlar → Geliştirici → "Agent bağlantısı (deneysel)" açılır.
2. Ayarlar sayfası kurulum komutlarını gösterir:

   Claude Code:

   ```bash
   claude mcp add --transport http yalqen http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
   ```

   Codex (`~/.codex/config.toml`):

   ```toml
   [mcp_servers.yalqen]
   url = "http://127.0.0.1:<port>/mcp"
   bearer_token_env_var = "YALQEN_MCP_TOKEN"
   ```

3. "Kopyala" ve "Token'ı yenile" düğmeleri bulunur.
4. Bir agent bağlandığında toolbar'daki geliştirici göstergesinde küçük bir nokta görünür. Agent bir sekmeyi okuduğunda gösterge kısa süre vurgulanır; kullanıcı neyin okunduğunu her zaman bilir.

**Teknik tasarım**

Yeni domain klasörü `src/main/agent-bridge/`:

| Dosya               | Sorumluluk                                                 |
| ------------------- | ---------------------------------------------------------- |
| `server.ts`         | HTTP sunucusu ve MCP oturumları, açma/kapama, port seçimi  |
| `auth.ts`           | Bearer token kontrolü, `Origin` ve `Host` doğrulaması      |
| `tab-scope.ts`      | Hangi sekmelerin agent'a görünür olduğuna karar verir      |
| `runtime-buffer.ts` | Sekme başına console ve network halka tamponları           |
| `cdp-events.ts`     | CDP olaylarını tampon kayıtlarına çeviren saf fonksiyonlar |
| `redact.ts`         | Hassas header ve değerleri maskeler                        |
| `tools.ts`          | MCP tool tanımları ve girdi doğrulaması                    |

- **Kapsam:** `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` ve `*.test`, ayrıca ayarlardan eklenen origin'ler. `src/main/privacy/passwords.ts` içindeki `LOCAL_HOSTS` ortak bir yardımcıya taşınır. Gizli pencereler hiçbir zaman kapsamda değildir.
- **Veri toplama:** Yalnızca köprü açıkken ve yalnızca kapsamdaki sekmelerde.
  - `Runtime.enable`: `consoleAPICalled` ve stack trace'li `exceptionThrown`.
  - `Log.enable`: tarayıcının ürettiği hatalar (CSP, mixed content ve benzerleri).
  - `Network.enable`: `requestWillBeSent` (initiator dahil), `responseReceived`, `loadingFinished`, `loadingFailed`.
  - Response body yalnızca talep edildiğinde ve yalnızca 400 ve üzeri istekler için `Network.getResponseBody` ile alınır; 64 KB'de kesilir.
- **Tampon sınırları:** sekme başına son 200 console kaydı ve son 300 istek. Sekme kapanınca ya da memory saver sekmeyi boşaltınca silinir.
- **CDP paylaşımı:** `page-debugger.ts` tek bir `attach` yapar. Sayfa override'ları, cihaz emülasyonu ve köprü aynı bağlantıyı tek bir `message` dinleyicisi üzerinden paylaşır. DevTools açıkken de çalıştığı test edilir.
- **Mevcut sayaç:** `tabs.ts` içindeki `console-message` sayacı olduğu gibi kalır. Köprü, stack trace gerektiği için kendi CDP kaynağını kullanır.

**Faz 1 tool'ları**

| Tool                   | Girdi                                                       | Çıktı                                                                    |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `list_tabs`            | —                                                           | Kapsamdaki sekmeler: id, url, başlık, aktif mi                           |
| `get_page_info`        | `tab?`                                                      | URL, başlık, viewport, cihaz emülasyonu, renk şeması, aktif override'lar |
| `get_console_errors`   | `tab?`, `since?`, `include_warnings?`                       | Seviye, mesaj, kaynak `url:satır`, stack                                 |
| `get_network_requests` | `tab?`, `failed_only?` (varsayılan `true`), `url_contains?` | Method, URL, status, süre, initiator                                     |
| `get_request_details`  | `request_id`                                                | Maskelenmiş header'lar, request body, kesilmiş response body             |
| `take_screenshot`      | `tab?`, `full_page?`                                        | PNG (tam sayfa için `captureFullPage` kullanılır)                        |
| `reload_page`          | `tab?`, `ignore_cache?`                                     | Yeniden yükleme sonucu                                                   |

`tab` verilmezse odaklı penceredeki aktif ve kapsamdaki sekme kullanılır.

**Güvenlik (bu fazda tamamlanır)**

- Sunucu yalnızca `127.0.0.1`'e bağlanır.
- 32 baytlık rastgele token `safeStorage` ile şifrelenmiş olarak saklanır.
- `Origin` header'ı olan her istek reddedilir. Böylece Yalqen'de ya da başka bir browser'da açık bir sayfa yerel porta istek atamaz.
- `Host` header'ı `127.0.0.1:<port>` ya da `localhost:<port>` değilse istek reddedilir (DNS rebinding koruması).
- `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` ve `X-Api-Key` benzeri header'lar varsayılan olarak maskelenir.
- Tool açıklamalarında ve çıktılarında, sayfadan gelen metnin talimat değil veri olduğu belirtilir (prompt injection'a karşı).

**Testler** (`test/main/agent-bridge/`)

- Token yoksa, token yanlışsa, `Origin` varsa ve `Host` yanlışsa istek reddedilir.
- Kapsam filtresi: localhost kabul edilir; normal siteler ve gizli pencereler reddedilir.
- Tamponlar sınırda en eski kaydı atar.
- Maskeleme beklenen header'ları yakalar.
- MCP SDK istemcisiyle sunucu başlatılıp tool'lar uçtan uca çağrılır.

**Performans**

- Köprü kapalıyken `npm run bench` sonuçları değişmemeli. Hiçbir dinleyici ve açık port olmamalı (`lsof -i` ile kontrol edilir).
- Köprü açıkken yalnızca localhost sayfalarında küçük bir maliyet kabul edilir; ölçülüp performans raporuna yazılır.

**Çıkış kriterleri**

- Örnek Next.js uygulamasında Claude Code ve Codex'e "son hatayı incele" yazıldığında agent, 500 dönen isteği ve `TypeError`'ı Yalqen'den okuyup doğru dosyaya ulaşır.
- Normal bir sitede (ör. github.com) hiçbir tool veri döndürmez.
- Özellik "deneysel" etiketiyle yayınlanır.

### Faz 2: Element seçici (2 hafta)

**Amaç:** Developer'ın bir elementi işaret etmesi ve agent'ın onu "seçili element" olarak alabilmesi. Bu fazda bağlam DOM düzeyindedir; component eşleme Faz 3'te gelir.

**Kullanıcı deneyimi**

1. Kısayol (öneri: `⌥⌘P`; macOS'ta yalnızca `⌥` ile başlayan kısayollar karakter yazdığı için kullanılmaz), geliştirici menüsü ya da komut çubuğunda `>pick` ile seçim modu açılır.
2. Fare elementlerin üzerinde gezinirken Chromium'un kendi vurgusu görünür. `Esc` ile çıkılır.
3. Tıklanınca küçük bir bildirim çıkar:

   ```
   Seçildi: button.primary "Sepete ekle"
   yk_3a271 panoya kopyalandı
   ```

4. Developer terminalde "seçili butonu mobilde tam genişlik yap" yazar. Agent `get_selected_element` ile seçimi alır.
5. İsteğe bağlı: `⇧` basılıyken tıklamak birden fazla elementi aynı seçime ekler.

**Teknik tasarım**

- Seçim modu `Overlay.setInspectMode({ mode: 'searchForNode' })` ile açılır, `Overlay.inspectNodeRequested` olayıyla seçilen node alınır. Sayfaya script enjekte etmek gerekmez.
- Seçim anında bir anlık görüntü alınır ve değişmez olarak saklanır. HMR sonrası node kaybolsa bile seçim geçerli kalır.
  - `DOM.describeNode`, `DOM.getOuterHTML` (4 KB'de kesilir)
  - `CSS.getComputedStyleForNode` (yalnızca yerleşimle ilgili özellikler: display, position, width, flex/grid, margin, padding, font, color)
  - `DOM.getBoxModel` ve kutuya göre kırpılmış element ekran görüntüsü
  - `Accessibility.getPartialAXTree` ile erişilebilir ad ve rol
  - Ata zinciri: her seviyede etiket, id, sınıflar ve kısa metin
- Seçim kimliği `yk_` ile başlayan 6 haneli hex'tir. Sekme başına son 10 seçim saklanır.
- Bildirim mevcut toolbar bildirim stilini kullanır; yeni bir panel eklenmez.

**Yeni tool'lar**

| Tool                   | Girdi           | Çıktı                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------ |
| `get_selected_element` | `selection_id?` | HTML, stiller, kutu, erişilebilir ad, ata zinciri, ekran görüntüsü |
| `list_selections`      | `tab?`          | Son seçimler: id, kısa açıklama, zaman                             |

**Çıkış kriterleri**

- Üç örnek uygulamada 10'ar görevde agent, yalnızca DOM bağlamıyla doğru dosyayı bulma oranı ölçülür ve kaydedilir. Bu oran Faz 3'ün kazancını ölçmek için temel olur.
- Seçim modu iframe içindeki elementlerde de çalışır ya da açıkça desteklenmediğini söyler.

### Faz 3: Component ve kaynak eşleme (3–4 hafta)

**Amaç:** Seçilen elementi React component'ine ve `dosya:satır` bilgisine bağlamak. İlk hedef React ve Next.js'tir.

**Kullanıcı deneyimi**

Bildirim artık şöyle görünür:

```
Seçildi: AddToCartButton
src/features/product/AddToCartButton.tsx:84
ProductPage › ProductDetails › PurchaseActions › AddToCartButton
```

**Teknik tasarım**

- **Başlangıç denemesi (ilk hafta):** Sıfırdan yazmak yerine `bippy` (MIT, react-grab'ın altyapısı) kullanılabilir mi, değerlendirilir. Lisans, boyut ve React 19 desteği karşılaştırılıp karar kayda eklenir.
- **Hook enjeksiyonu:** Köprü açıkken ve yalnızca kapsamdaki sekmelerde `Page.addScriptToEvaluateOnNewDocument` ile, React yüklenmeden önce küçük bir `__REACT_DEVTOOLS_GLOBAL_HOOK__` yerleştirilir. React DevTools extension'ı yüklüyse onunla çakışmaz, mevcut hook'a eklenir.
- **Component zinciri:** Seçilen DOM node'undaki `__reactFiber$...` anahtarından fiber bulunur ve `return` zinciri yukarı yürünerek kullanıcı component'leri (host olmayanlar) listelenir.
- **Kaynak konumu:**
  - React 18 ve öncesi: fiber üzerindeki `_debugSource`.
  - React 19: `_debugSource` kaldırıldı. Fiber üzerindeki `_debugStack` ayrıştırılır, bundle'daki `url:satır:sütun` bilgisi dev server'ın source map'iyle (`source-map-js`, BSD-3) gerçek dosyaya çevrilir. Source map'ler betik URL'si başına önbelleğe alınır.
  - Yol normalleştirme: `webpack-internal:///`, `turbopack://`, Vite'ın `/src/...` ve `/@fs/...` biçimleri proje yoluna çevrilir.
- **Props:** Yalnızca ilk seviye ve ilkel değerler; fonksiyonlar `[Function onClick]` olarak, uzun metinler kesilerek verilir.
- **Güven seviyesi:** Her sonuç bir güven seviyesi taşır: `exact` (source map'ten kesin satır), `component` (yalnızca component adı), `dom` (yalnızca DOM). Agent tahmini sonucu kesin sanmaz.

**Değişen ve yeni tool'lar**

- `get_selected_element` artık `component`, `source { file, line, column, confidence }`, `owner_chain` ve `props` alanlarını da döndürür.
- `get_component_tree(selection_id, depth?)`: seçimin çevresindeki component ağacı.

**Test matrisi**

| Uygulama             | Bundler   | React | Beklenen                 |
| -------------------- | --------- | ----- | ------------------------ |
| Next.js App Router   | Turbopack | 19    | `exact` (source map)     |
| Next.js Pages Router | webpack   | 19    | `exact`                  |
| Vite + React         | Vite      | 19    | `exact`                  |
| webpack + React      | webpack   | 18    | `exact` (`_debugSource`) |
| Production build     | —         | 19    | `component` ya da `dom`  |
| React olmayan sayfa  | —         | —     | `dom`, hata yok          |

**Çıkış kriterleri**

- Matristeki geliştirme build'lerinde, kullanıcı component'lerinin render ettiği elementler için `dosya:satır` doğruluğu %90'ın üzerinde.
- Faz 2'deki 30 görev tekrarlanır; agent'ın doğru dosyaya ulaşma oranındaki artış ölçülür.
- Hook enjeksiyonu localhost dışındaki hiçbir sayfada çalışmaz (test ile doğrulanır).

### Faz 4: Runtime Timeline (3–4 hafta)

**Amaç:** "Butona bastıktan sonra tam olarak ne oldu?" sorusunu tek yerde cevaplamak. Ürünün asıl farklılaşması bu fazdadır.

**Kullanıcı deneyimi**

- Toolbar'daki geliştirici göstergesi, bir hata olduğunda son "hata bölümünü" kısa bir liste olarak gösterir:

  ```
  10:31:14  "Kaydet" tıklandı (UserForm)
  10:31:14  POST /api/users
  10:31:15  500 Internal Server Error
  10:31:15  TypeError: Cannot read properties of undefined (reading 'id')
  ```

- "Referansı kopyala" düğmesi `yk_ep_91f20` gibi bir bölüm kimliğini panoya kopyalar. Terminalde "yk_ep_91f20'yi incele" demek yeterlidir.

**Teknik tasarım**

- **Olay modeli:**

  ```ts
  interface TimelineEvent {
    id: string;
    tabId: number;
    time: number;
    kind:
      | "navigation"
      | "click"
      | "input"
      | "submit"
      | "request"
      | "response"
      | "console"
      | "exception";
    data: unknown;
    causeId?: string;
    causeConfidence?: "direct" | "likely";
  }
  ```

- **Kullanıcı eylemleri:** Kapsamdaki sekmelere enjekte edilen küçük bir script, capture aşamasında `click`, `submit`, `change` ve Enter tuşunu dinler ve `Runtime.addBinding` ile main sürece iletir. Preload'a yeni IPC eklenmez.
- **Girdi gizliliği:** Input değerleri kaydedilmez, yalnızca uzunlukları kaydedilir. Parola alanları hiç kaydedilmez. İsteğe bağlı bir ayar, localhost'ta değerlerin kaydedilmesine izin verir.
- **Neden-sonuç bağları:**
  - `Network.requestWillBeSent` içindeki `initiator.stack`, bir kullanıcı eyleminin işleyicisini içeriyorsa bağ `direct` olur.
  - İstek bir eylemden sonraki 1 saniye içinde başlıyorsa ve stack yoksa bağ `likely` olur.
  - Bir exception'ın stack'i aynı işleyiciye işaret ediyorsa isteğe bağlanır.
  - Agent'a "olası" bağların kesin olmadığı açıkça söylenir.
- **Hata bölümü:** 400 ve üzeri bir yanıt ya da yakalanmamış bir exception, önceki 10 saniyedeki olaylarla birlikte bir bölüm olarak gruplanır.
- **Sınırlar:** sekme başına son 1.000 olay ve son 20 bölüm, yalnızca bellekte.

**Yeni tool'lar**

| Tool                  | Girdi                      | Çıktı                                                 |
| --------------------- | -------------------------- | ----------------------------------------------------- |
| `get_timeline`        | `tab?`, `since?`, `limit?` | Zaman sıralı olaylar ve bağları                       |
| `get_error_episode`   | `episode_id?` (son bölüm)  | Bölümdeki olaylar, istek ayrıntıları, ilgili seçimler |
| `list_error_episodes` | `tab?`                     | Bölüm özetleri                                        |

**Çıkış kriterleri**

- Örnek uygulamalardaki üç hata senaryosunda bölüm, olayları doğru sırada ve doğru bağlarla gösterir.
- Localhost sayfa yüklemelerinde ek yük ölçülür; anlamlı bir fark varsa enjeksiyon küçültülür.
- Agent yalnızca bölüm kimliğiyle sorunun nedenini, başlangıç ölçümüne göre daha az adımda bulur.

### Faz 5: Agent eylemleri ve doğrulama (3 hafta)

**Amaç:** Agent'ın düzeltmeden sonra aynı akışı tekrar çalıştırıp sonucu kendisi doğrulaması.

**Kullanıcı deneyimi**

- Ayarlar → Geliştirici → "Agent eylemleri": Kapalı / Her seferinde sor (varsayılan) / İzin ver.
- Agent bir sekmeyi kontrol ederken sekmenin çevresinde belirgin bir çerçeve ve "Agent kontrol ediyor · Durdur" düğmesi görünür.
- Doğrulama sonucu bildirim olarak da gösterilir:

  ```
  Doğrulama başarılı
  POST /api/users → 201
  Console hatası yok
  ```

**Teknik tasarım**

- Eylemler CDP `Input.dispatchMouseEvent` ve `Input.insertText` ile yapılır; gerçek kullanıcı girdisine en yakın yol budur.
- Gezinme yalnızca kapsamdaki origin'lere izinlidir.
- HMR beklemesi: `Page.frameNavigated`, Vite/Next HMR console mesajları ya da ağın durulması beklenir.
- Tekrar oynatma: bir hata bölümündeki kullanıcı eylemleri sırayla oynatılır. Sonuç, bölümdeki istek durumları ve hatalarla karşılaştırılır.
- `evaluate` (sayfada keyfi JavaScript çalıştırma) bu fazda eklenmez.

**Yeni tool'lar**

| Tool             | Girdi                                    | Çıktı                                                 |
| ---------------- | ---------------------------------------- | ----------------------------------------------------- |
| `click`          | `selector` ya da `selection_id`          | Sonuç ve ardından gelen olaylar                       |
| `fill`           | `selector`, `value`                      | Sonuç                                                 |
| `navigate`       | `url` (kapsam içinde)                    | Sonuç                                                 |
| `wait_for`       | `selector?`, `network_idle?`, `timeout?` | Sonuç                                                 |
| `replay_episode` | `episode_id`                             | Yeni bölüm ve öncekiyle fark: `passed` ya da `failed` |

**Çıkış kriterleri**

- Örnek uygulamada agent hatayı düzeltir, `replay_episode` çağırır ve "201, console hatası yok" sonucunu alır.
- "Kapalı" ayarındayken hiçbir eylem tool'u çalışmaz; "Her seferinde sor" ayarında onay penceresi olmadan hiçbir eylem yapılmaz.

### Faz 6: Koşullu backlog

Bu maddeler yalnızca metrikler izin verirse ve sırayla değil, talebe göre ele alınır.

- **Request kuralları için MCP:** `mock_response`, `block_request` ve `redirect_request` tool'ları, mevcut `request-rules.ts` altyapısını kullanır. Maliyeti düşüktür.
- **İsteği tekrar gönderme:** Başarısız bir isteğin body'si değiştirilerek tekrar gönderilir.
- **Playwright testi üretme:** Bir hata bölümünden test dosyası üretilir.
- **Vue ve Svelte desteği:** React'ten kolaydır. Vue geliştirme build'leri `__vueParentComponent.type.__file`, Svelte geliştirme build'leri `__svelte_meta` üzerinden dosya konumunu verir.
- **Backend izleme:** Localhost isteklerine `traceparent` header'ı eklenir ve yerel bir OTLP alıcısı backend span'larını aynı timeline'a bağlar.
- **WebMCP:** Sayfa `navigator.modelContext` ile tool tanımlıyorsa bunlar agent'a aktarılır.
- **Terminale gönderme:** Ancak kullanıcılar açıkça isterse ve yalnızca `yalqen claude` gibi bir sarmalayıcıyla.

## 6. Güvenlik ve gizlilik modeli

| Tehdit                                         | Önlem                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bir web sayfasının yerel porta istek atması    | `Origin` olan istekler reddedilir, `Host` doğrulanır, token zorunludur                |
| Makinedeki başka bir sürecin porta bağlanması  | Bearer token; token yenilenebilir                                                     |
| Agent'ın banka ya da e-posta sekmesini okuması | Yalnızca localhost ve izinli origin'ler; gizli pencereler hiçbir zaman kapsamda değil |
| Network verisindeki gizli bilgiler             | Hassas header'lar maskelenir, body'ler kesilir                                        |
| Sayfa içeriğinden prompt injection             | Tool çıktıları "güvenilmeyen sayfa verisi" olarak işaretlenir                         |
| Agent'ın istenmeyen eylem yapması              | Eylemler varsayılan olarak onay ister, görünür çerçeve ve durdurma düğmesi            |
| Verilerin kalıcı hale gelmesi                  | Her şey bellekte; diske yazılmaz, sekme kapanınca silinir                             |

Her fazın sonunda [SECURITY.md](../.github/SECURITY.md) ve gizlilik sayfası bu tabloya göre güncellenir.

## 7. Başarı metrikleri

Yalqen'in gizlilik çizgisi nedeniyle bu özellik için otomatik telemetri eklenmez. Ölçüm üç yoldan yapılır:

- **Kendi kullanımın:** Faz 0'daki başlangıç ölçümüyle karşılaştırma. Context anlatma süresi, agent'ın yanlış dosyaya gitme sayısı ve haftalık kullanım sayısı.
- **Yerel sayaçlar:** Ayarlar → Geliştirici altında yalnızca kullanıcının görebildiği sayaçlar: bu hafta yapılan seçim sayısı, agent'ın tool çağrısı sayısı. Beta kullanıcıları isterse bunları elle paylaşır.
- **Beta grubu:** 5–10 developer. Her faz sonunda kısa bir görüşme yapılır.

Hedefler:

- Faz 2 sonunda: sen ve beta grubunun yarısından fazlası haftada en az 3 kez kullanıyor.
- Faz 3 sonunda: agent'ın doğru dosyaya ilk denemede ulaşma oranı, Faz 2'ye göre belirgin şekilde artmış.
- 4 hafta sonra: beta kullanıcılarının çoğu özelliği hâlâ açık tutuyor.

## 8. Karar noktaları

| Ne zaman   | Soru                                                    | Olumsuzsa                                                    |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Faz 0 sonu | Context taşıma gerçekten zaman kaybettiriyor mu?        | Projeyi durdur; Yalqen'in temel browser işlerine dön         |
| Faz 2 sonu | Haftada en az 3 kullanım hedefi tuttu mu?               | Faz 3'e geçme; geri bildirime göre yön değiştir ya da durdur |
| Faz 3 sonu | React eşlemesi %70'in üzerinde mi?                      | Kendi eşlemeni bırak, react-grab/bippy entegrasyonuna geç    |
| Faz 4 sonu | Timeline kullanılıyor mu, agent'ın işini kısaltıyor mu? | Faz 5'i ertele; Faz 1–3'ü cilala                             |

## 9. Açık sorular

- **Port:** Sabit varsayılan port mu, yoksa her açılışta rastgele port mu? Sabit port kurulum komutunu bir kez yazmayı sağlar; rastgele port daha güvenlidir ama komut her seferinde değişir.
- **Birden fazla pencere ve profil:** Varsayılan sekme seçimi odaklı pencereye göre mi yapılmalı, yoksa agent her seferinde sekme mi belirtmeli?
- **Uzak geliştirme ortamları:** `*.ngrok.app` ya da Codespaces gibi adresler, kullanıcının elle eklediği origin'lerle mi desteklenmeli?
- **CEF + AppKit geçişi:** CEF de DevTools protokolünü destekliyor. Saf fonksiyon olarak yazılan CDP mantığı taşınabilir; yalnızca Electron'a bağlı ince katman yeniden yazılır.
- **Lisanslar:** `source-map-js` (BSD-3) ve kullanılırsa `bippy` (MIT) [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md) dosyasına eklenir.

## 10. Kalıcı olarak kapsam dışı

- Yalqen içinde AI modeli, chat paneli ya da ücretli servis.
- Bulut senkronizasyonu ya da toplanan verinin makineden çıkması.
- Varsayılan olarak localhost dışındaki sayfaların agent'a açılması.
- Ayrı bir "Normal Mode / Developer Mode" anahtarı.
