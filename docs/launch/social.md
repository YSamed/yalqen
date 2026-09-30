# Social posts (drafts)

Replace `@handle` placeholders and attach `design/readme/demo.gif` (or the MP4, which X and Bluesky play better) to the first post.

## X / Bluesky thread

Bluesky posts are limited to 300 characters; each post below fits.

**1/5** (attach demo video)

```
I built an open-source browser for developers on macOS: Yalqen.

Vertical tabs, a keyboard-first command bar, one-key phone view, and ad blocking built in.

Free, MIT licensed, signed and notarized.

https://github.com/YSamed/yalqen
```

**2/5**

```
Everything is on the keyboard.

⌘L opens the command bar for navigation and every action.
⌥⌘M toggles phone view with iPhone, Pixel, Galaxy and iPad presets.
⌥⌘I opens DevTools.
```

**3/5**

```
Privacy is the default, not an extension:

• ad and tracker blocking
• third-party cookie blocking
• HTTPS-only mode
• secure DNS
```

**4/5**

```
Yes, it's Electron. That's how one person gets a real Chromium with DevTools and extensions. It has costs, and I wrote them down honestly, with benchmarks:

https://github.com/YSamed/yalqen/blob/main/docs/why-electron.md
```

**5/5**

```
Apple Silicon, macOS 13+.

brew install --cask YSamed/yalqen/yalqen

Feedback, issues and stars all help. Thanks for reading!
```

## Release announcement (short, reusable)

Generated per release by `node apps/browser/scripts/release-announcement.mjs` (see [RELEASING.md](../../apps/browser/RELEASING.md)).

## LinkedIn (Türkçe)

```
Son zamanlarda üzerinde çalıştığım projeyi paylaşmak istiyorum: Yalqen.

Yalqen, macOS için geliştiricilere yönelik açık kaynaklı (MIT) bir web tarayıcısı. Günün büyük kısmını tarayıcıda, dokümantasyon, localhost ve DevTools arasında geçiren biri olarak kendi ihtiyacım için yaptım:

• Sekmeler, adres çubuğu ve pencere kontrolleri tek bir dikey panelde
• Klavyeyle her şeye ulaşılan komut çubuğu
• Tek tuşla telefon görünümü (iPhone, Pixel, Galaxy, iPad önayarları) ve Chromium geliştirici araçları
• Yerleşik reklam ve izleyici engelleme, üçüncü taraf çerez engelleme, yalnızca HTTPS modu ve güvenli DNS
• Uzun süre bakmadığınız sekmeleri boşaltan bellek tasarrufu
• Chrome Web Mağazası eklentileri, şifre kaydetme ve otomatik doldurma

Electron, Svelte 5 ve TypeScript ile yazıldı. Her sürüm Apple tarafından imzalanıp onaylanıyor ve uygulama kendini arka planda güncelliyor.

Electron seçiminin bedelini ve ileriye dönük planı dürüstçe yazdım, ölçümlerle birlikte. Geri bildirimlerinizi ve katkılarınızı bekliyorum.

🔗 https://github.com/YSamed/yalqen
🌐 https://yalqen.com/?utm_source=linkedin&utm_medium=social

#açıkkaynak #opensource #macos #webdevelopment #tarayıcı
```
