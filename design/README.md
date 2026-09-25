# Tasarım

- [`TOKENS.md`](TOKENS.md) — renkler, yazı, ölçüler ve sekme durumlarının görsel dili. Varsayılan görünüm cam (Liquid Glass); opak görünüm "Saydamlığı azalt" içindir.
- [`brand/`](brand) — logo: uygulama ikonu (`icon.svg`), açık ve koyu zemin için işaret (`mark.svg`, `mark-dark.svg`), 16–1024 px PNG'ler (`png/`). Renkler `TOKENS.md` ile aynı: vurgu `accent`, gövde `text`.
- [`canvas/`](canvas) — Faz 0 arayüz taslağının kaynağı (etkileşimli tasarım sayfası). Her `.dc.html` bir ekran; `Main.dc.html` tüm durumları yöneten ana ekran, diğerleri onu farklı başlangıç durumlarıyla gösterir.

Taslaktaki ekranlar:

| Dosya | Ekran |
|---|---|
| `Main.dc.html` | Geniş panel (etkileşimli), cam |
| `Narrow.dc.html` | Dar panel, uyuyan sekmenin ipucu balonu |
| `Memory.dc.html` | RAM ayrıntısı |
| `Warning.dc.html` | Aktif ve canlı tutulan sekmeler bellek hedefini aşıyor |
| `Settings.dc.html` | Ayarlar |
| `NewTab.dc.html` | Yeni sekme, adres çubuğu odakta |
| `Dark.dc.html`, `DarkNarrow.dc.html` | Koyu tema |
| `Opaque.dc.html`, `OpaqueDark.dc.html`, `OpaqueMemory.dc.html`, `OpaqueNarrow.dc.html` | Opak görünüm ("Saydamlığı azalt"): açık, koyu, RAM ayrıntısı, dar panel |
