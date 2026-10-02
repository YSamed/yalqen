<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/readme/wordmark-dark.png">
    <img src="design/readme/wordmark-light.png" alt="Yalqen" width="300">
  </picture>

  <p>
    <strong>macOS'ta geliştiriciler için klavye öncelikli Chromium tarayıcısı.</strong><br>
    Dikey sekmeler, hızlı komut çubuğu, yerleşik reklam ve izleyici engelleme<br>ve gereksiz arayüzden arınmış geliştirici araçları.
  </p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/download-dmg-dark.png"><img src="design/readme/download-dmg.png" alt="DMG dosyasını indir" width="250"></picture></a>
    <a href="#kurulum"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/install-homebrew-dark.png"><img src="design/readme/install-homebrew.png" alt="Homebrew ile kur" width="250"></picture></a>
    <br>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-dark.svg"><img src="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-light.svg" alt="Son sürüm ve toplam indirme sayısı" height="56"></picture></a>
  </p>

  <p>
    <sub>
      <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">Web sitesi</a> ·
      <a href="apps/browser/CHANGELOG.md">Değişiklik günlüğü</a> ·
      <a href="CONTRIBUTING.md">Katkıda bulun</a> ·
      <a href="https://github.com/YSamed/yalqen/issues">Hata bildir</a> ·
      <a href="README.md">English</a> ·
      <a href="README.zh-CN.md">简体中文</a>
    </sub>
  </p>
</div>

<p align="center">
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="design/screenshots/website-dark.png"><img src="design/screenshots/website-light.png" alt="Yalqen web sitesi" width="900"></picture></a>
</p>

## Özellikler

Yalqen, tarayıcı arayüzü yoluna çıkmadan Chromium uyumluluğu isteyen geliştiriciler için.

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/command-dark.tr.svg"><img src="design/readme/cards/command-light.tr.svg" alt="Komut çubuğu" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/tabs-dark.tr.svg"><img src="design/readme/cards/tabs-light.tr.svg" alt="Dikey sekmeler" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/devtools-dark.tr.svg"><img src="design/readme/cards/devtools-light.tr.svg" alt="Geliştirici araçları" width="268"></picture>
  <br>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/blocking-dark.tr.svg"><img src="design/readme/cards/blocking-light.tr.svg" alt="Reklam engelleme" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/https-dark.tr.svg"><img src="design/readme/cards/https-light.tr.svg" alt="HTTPS ve güvenli DNS" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/memory-dark.tr.svg"><img src="design/readme/cards/memory-light.tr.svg" alt="Bellek tasarrufu" width="268"></picture>
</p>

Tüm [klavye kısayollarına](docs/keyboard-shortcuts.tr.md) göz atın. Yalqen ayrıca yedi yerleşik arama motoruyla gelir.

## Kurulum

> [!NOTE]
> macOS 13 veya üzeri ve Apple Silicon gerekir.

```bash
brew install --cask YSamed/yalqen/yalqen
```

Ya da DMG dosyasını [Releases](https://github.com/YSamed/yalqen/releases/latest) sayfasından indirin. Uygulama imzalı ve notarize edilmiştir, kendini güncel tutar.

<details>
<summary>Güncelleme, kaldırma ve kullanım ölçümü</summary>

Güncellemeyi Homebrew ile yapmak için:

```bash
brew upgrade --cask yalqen
```

Kaldırmak ve verilerini silmek için:

```bash
brew uninstall --zap --cask yalqen
```

Aktif kurulum ölçümü varsayılan olarak kapalıdır, **Ayarlar → Gizlilik** bölümünden açılabilir. [Rozet sayaçlarının ayrıntıları](docs/usage-measurement.md).

</details>

## Geliştirme

```bash
cd apps/browser
npm ci
npm start
```

Node.js 22.12 veya üzeri gerekir. Kontroller ve pull request'ler için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

---

<p align="center"><sub><a href="LICENSE">MIT Lisansı</a> · Filtre listeleri <a href="apps/browser/THIRD_PARTY_NOTICES.md">kendi lisanslarını</a> korur · Yalqen adı ve logosu MIT Lisansı kapsamında değildir</sub></p>

<p align="center"><sub>Yalqen işinize yarıyorsa depoya yıldız verin. Projenin başka geliştiricilere ulaşmasına yardımcı olur.</sub></p>

<p align="center">
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>
