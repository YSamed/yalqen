<div align="center">
  <img src="design/brand/png/icon-256.png" alt="Yalqen" width="112">

  <h1>Yalqen</h1>

  <p>macOS için açık kaynaklı, Chromium tabanlı geliştirici tarayıcısı. Dikey sekmeler, klavye öncelikli komut çubuğu, yerleşik reklam engelleme.</p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><img src="design/readme/download-button.png" alt="macOS için indir" width="260"></a>
  </p>

  <p>
    <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">Web sitesi</a> ·
    <a href="apps/browser/CHANGELOG.md">Değişiklik günlüğü</a> ·
    <a href="CONTRIBUTING.md">Katkıda bulun</a> ·
    <a href="https://github.com/YSamed/yalqen/issues">Hata bildir</a> ·
    <a href="README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

## Özellikler

- **Dikey sekmeler**: sabitlenmiş sekmeler, adres çubuğu ve pencere düğmeleri tek panelde
- **Komut çubuğu** ile klavye öncelikli gezinme ve eylemler ([klavye kısayolları](docs/keyboard-shortcuts.tr.md))
- Yerleşik filtre motoruyla **reklam ve izleyici engelleme**, üçüncü taraf çerez engelleme
- **Yalnızca HTTPS modu** ve **güvenli DNS**
- **Geliştirici araçları** ve tek tuşla **telefon görünümü**
- **Bellek tasarrufu** ve yedi yerleşik arama motoru

## Kurulum

> **macOS 13 veya üzeri ve Apple Silicon gerekir.** Intel Mac'ler desteklenmez.

[Homebrew](https://brew.sh) ile:

```bash
brew install --cask YSamed/yalqen/yalqen
```

Ya da DMG dosyasını [Releases](https://github.com/YSamed/yalqen/releases/latest) sayfasından indirin. Uygulama Developer ID ile imzalı ve notarize edilmiştir, Gatekeeper uyarısı olmadan açılır.

Yalqen arka planda kendini günceller. Güncellemeyi Homebrew ile yapmak için:

```bash
brew upgrade --cask yalqen
```

Kaldırmak ve verilerini silmek için:

```bash
brew uninstall --zap --cask yalqen
```

## Geliştirme

Uygulama `apps/browser` klasöründe. Node.js 22.12 veya üzeri gerekir.

```bash
cd apps/browser
npm ci
npm start
```

Diğer komutlar, hepsi `apps/browser` içinden çalıştırılır:

| Komut                 | Ne yapar                                      |
| --------------------- | --------------------------------------------- |
| `npm run check`       | Lint, biçim kontrolü, tip kontrolü ve testler |
| `npm test`            | Yalnızca testler                              |
| `npm run package:mac` | macOS uygulama paketini derler                |

Pull request açmadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun.

## Lisans

- Yalqen [MIT Lisansı](LICENSE) ile yayınlanır.
- Dahil edilen filtre listeleri kendi lisanslarını korur, bkz. [THIRD_PARTY_NOTICES.md](apps/browser/THIRD_PARTY_NOTICES.md).
- Yalqen adı ve logosu MIT Lisansı kapsamında değildir.
