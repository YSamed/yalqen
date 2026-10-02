# Teknik ayrıntılar

<p>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>

[README](../README.tr.md) · [English](README.md) · Türkçe · [简体中文](README.zh-CN.md)

## Gereksinimler

Apple Silicon üzerinde macOS 13 Ventura veya üzeri. Intel Mac'ler desteklenmez.

## Kurulum

[Homebrew](https://brew.sh) ile:

```bash
brew install --cask YSamed/yalqen/yalqen
```

Ya da DMG dosyasını [Releases](https://github.com/YSamed/yalqen/releases/latest) sayfasından indirin. Uygulama Developer ID ile imzalı ve notarize edilmiştir, Gatekeeper uyarısı olmadan açılır.

## Güncellemeler

Yalqen güncellemeleri arka planda denetler ve yeniden başlatınca kurar. Güncellemeyi Homebrew ile yapmak için:

```bash
brew upgrade --cask yalqen
```

## Kaldırma

Homebrew ile kaldırmak ve verilerini silmek için:

```bash
brew uninstall --zap --cask yalqen
```

Homebrew kullanmıyorsanız Yalqen'den çıkıp uygulamayı Çöp Sepeti'ne taşıyın. Profil verileri `~/Library/Application Support/yalqen-electron-prototype` klasöründedir.

## Kullanım ölçümü

Aktif kurulum ölçümü varsayılan olarak kapalıdır, **Ayarlar → Gizlilik** bölümünden açılabilir. Açıkken özel olmayan bir pencere açıkken UTC gününde en fazla bir kez yalnızca rastgele bir kurulum kimliği gönderilir. README'deki indirme sayısı tekrar indirmeleri de içerir; iki sayaç da tekil kişi saymaz. [Ölçümün ayrıntıları](usage-measurement.md).

## Geliştirme

Uygulama `apps/browser` klasöründedir ve Node.js 22.12 veya üzeri gerekir.

```bash
cd apps/browser
npm ci
npm start
```

| Komut                 | Ne yapar                                      |
| --------------------- | --------------------------------------------- |
| `npm run check`       | Lint, biçim kontrolü, tip kontrolü ve testler |
| `npm test`            | Yalnızca testler                              |
| `npm run bench`       | Açılış, sayfa yükleme ve boşta kalma ölçümü   |
| `npm run package:mac` | macOS uygulama paketini derler                |

Git hook'ları, commit mesajları ve pull request'ler için [CONTRIBUTING.md](../CONTRIBUTING.md) dosyasını okuyun.

## Daha fazlası

- [Klavye kısayolları](keyboard-shortcuts.tr.md)
- [Neden Electron?](why-electron.md)
- [Benchmark'lar](benchmarks.md)
- [İndirme ve aktif kurulum ölçümü](usage-measurement.md)
- [Güvenlik politikası](../SECURITY.md)

## Lisans

- Yalqen [MIT Lisansı](../LICENSE) ile yayınlanır.
- Dahil edilen filtre listeleri kendi lisanslarını korur, bkz. [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md).
- Yalqen adı ve logosu MIT Lisansı kapsamında değildir.
