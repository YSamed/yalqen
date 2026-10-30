# Teknik ayrıntılar

<p>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>

[README](../README.tr.md) · [English](README.md) · Türkçe · [简体中文](README.zh-CN.md)

## Gereksinimler

- **macOS:** Apple Silicon üzerinde macOS 13 Ventura veya üzeri. Intel Mac'ler desteklenmez.
- **Linux:** Node.js 24 ile kaynak koddan derlenen deneysel AppImage. İlk testler Ubuntu ve GNOME Wayland üzerinde yapıldı; Chromium sandbox koruması için ayrıcalıksız kullanıcı ad alanlarının çalışıyor olması gerekir.
- **Windows:** henüz desteklenmiyor.

## Kurulum

### macOS

[Homebrew](https://brew.sh) ile:

```bash
brew install --cask YSamed/yalqen/yalqen
```

Ya da DMG dosyasını [Releases](https://github.com/YSamed/yalqen/releases/latest) sayfasından indirin. Uygulama Developer ID ile imzalı ve notarize edilmiştir, Gatekeeper uyarısı olmadan açılır.

### Linux önizlemesi

Linux üzerinde Node.js 24 ve Git ile derleyin:

```bash
git clone https://github.com/YSamed/yalqen.git
cd yalqen/apps/browser
npm ci
npm run package:linux
```

AppImage, `apps/browser/release/` klasörüne yazılır. Açmadan önce çalıştırma izni verin. Hazır Linux paketleri henüz yayımlanmıyor. Chromium sandbox koruması için ayrıcalıksız kullanıcı ad alanlarının çalışması gerekir; Yalqen, `--no-sandbox` ile çalışmayı reddeder.

## Güncellemeler

Linux'ta otomatik güncellemeler henüz doğrulanmadı. Önizlemeyi güncellemek için kaynak kodu güncelleyip AppImage'i yeniden derleyin.

macOS'ta Yalqen güncellemeleri arka planda denetler ve yeniden başlatınca kurar. Güncellemeyi Homebrew ile yapmak için:

```bash
brew upgrade --cask yalqen
```

## Kaldırma (macOS)

Homebrew ile kaldırmak ve verilerini silmek için:

```bash
brew uninstall --zap --cask yalqen
```

Homebrew kullanmıyorsanız Yalqen'den çıkıp uygulamayı Çöp Sepeti'ne taşıyın. Profil verileri `~/Library/Application Support/yalqen-electron-prototype` klasöründedir.

## Kullanım ölçümü

Aktif kurulum ölçümü varsayılan olarak kapalıdır, **Ayarlar → Gizlilik** bölümünden açılabilir. Açıkken özel olmayan bir pencere açıkken UTC gününde en fazla bir kez yalnızca rastgele bir kurulum kimliği gönderilir. Bundan ayrı olarak her profil, teşekkür mektubundan sonra bir kez kimlik içermeyen boş bir istek gönderir ve isimsiz bir sayacı bir artırır. README'deki indirme sayısı tekrar indirmeleri de içerir; bu sayaçların hiçbiri tekil kişi saymaz. [Ölçümün ayrıntıları](usage-measurement.md).

## Geliştirme

Uygulama `apps/browser` klasöründedir. Katkı ortamı ve CI ile uyum için macOS veya Linux üzerinde Node.js 24 kullanın.

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
| `npm run package:linux` | Deneysel Linux AppImage paketini derler |

Git hook'ları, commit mesajları ve pull request'ler için [CONTRIBUTING.md](../.github/CONTRIBUTING.md) dosyasını okuyun.

## Daha fazlası

- [Klavye kısayolları](keyboard-shortcuts.tr.md)
- [Neden Electron?](decisions/why-electron.md)
- [Mimari](architecture.md)
- [Benchmark'lar](benchmarks.md)
- [Performans raporları](performance/)
- [İndirme ve aktif kurulum ölçümü](usage-measurement.md)
- [Güvenlik politikası](../.github/SECURITY.md)

## Lisans

- Yalqen [MIT Lisansı](../LICENSE) ile yayınlanır.
- Dahil edilen filtre listeleri kendi lisanslarını korur, bkz. [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md).
- Yalqen adı ve logosu MIT Lisansı kapsamında değildir.
