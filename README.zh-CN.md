<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/readme/wordmark-dark.png">
    <img src="design/readme/wordmark-light.png" alt="Yalqen" width="300">
  </picture>

  <p>
    <strong>面向 macOS 开发者的键盘优先 Chromium 浏览器。</strong><br>
    垂直标签页、快速命令栏、内置广告和跟踪器拦截，以及没有多余界面的开发者工具。
  </p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/download-dmg-dark.png"><img src="design/readme/download-dmg.png" alt="下载 DMG" width="250"></picture></a>
    <a href="#安装"><picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/install-homebrew-dark.png"><img src="design/readme/install-homebrew.png" alt="使用 Homebrew 安装" width="250"></picture></a>
    <br>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-dark.svg"><img src="https://raw.githubusercontent.com/YSamed/yalqen/badges/release-light.svg" alt="最新版本和总下载量" height="56"></picture></a>
  </p>

  <p>
    <sub>
      <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">官网</a> ·
      <a href="apps/browser/CHANGELOG.md">更新日志</a> ·
      <a href="CONTRIBUTING.md">参与贡献</a> ·
      <a href="README.md">English</a> ·
      <a href="README.tr.md">Türkçe</a>
    </sub>
  </p>
</div>

<p align="center">
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme"><picture><source media="(prefers-color-scheme: dark)" srcset="design/screenshots/website-dark.png"><img src="design/screenshots/website-light.png" alt="Yalqen 官网" width="900"></picture></a>
</p>

## 功能

Yalqen 适合想要 Chromium 兼容性、又不想被浏览器界面干扰的开发者。

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/command-dark.zh-CN.svg"><img src="design/readme/cards/command-light.zh-CN.svg" alt="命令栏" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/tabs-dark.zh-CN.svg"><img src="design/readme/cards/tabs-light.zh-CN.svg" alt="垂直标签页" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/devtools-dark.zh-CN.svg"><img src="design/readme/cards/devtools-light.zh-CN.svg" alt="开发者工具" width="268"></picture>
  <br>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/blocking-dark.zh-CN.svg"><img src="design/readme/cards/blocking-light.zh-CN.svg" alt="广告和跟踪器拦截" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/https-dark.zh-CN.svg"><img src="design/readme/cards/https-light.zh-CN.svg" alt="仅 HTTPS 和安全 DNS" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="design/readme/cards/memory-dark.zh-CN.svg"><img src="design/readme/cards/memory-light.zh-CN.svg" alt="内存节省" width="268"></picture>
</p>

查看全部[键盘快捷键](docs/keyboard-shortcuts.md)。Yalqen 还内置了七个搜索引擎。

## 安装

> [!NOTE]
> 需要 macOS 13 或更高版本，且仅支持 Apple Silicon。

```bash
brew install --cask YSamed/yalqen/yalqen
```

也可以从 [Releases](https://github.com/YSamed/yalqen/releases/latest) 下载 DMG。应用已签名并经过公证，会自动保持更新。

<details>
<summary>更新、卸载和使用统计</summary>

如需通过 Homebrew 更新：

```bash
brew upgrade --cask yalqen
```

卸载并删除其数据：

```bash
brew uninstall --zap --cask yalqen
```

活跃安装统计默认关闭，可在 **设置 → 隐私** 中开启。[徽章统计方式详情](docs/usage-measurement.md)。

</details>

## 开发

```bash
cd apps/browser
npm ci
npm start
```

需要 Node.js 22.12 或更高版本。检查命令和 Pull Request 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

<p align="center"><sub><a href="LICENSE">MIT 许可证</a> · 内置过滤列表保留<a href="apps/browser/THIRD_PARTY_NOTICES.md">各自的许可证</a> · Yalqen 名称和标志不在 MIT 许可证范围内</sub></p>

<p align="center"><sub>如果 Yalqen 对你有帮助，欢迎给仓库点个 Star，这能帮助更多开发者发现这个项目。</sub></p>

<p align="center">
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>
