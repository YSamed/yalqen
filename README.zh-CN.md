<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/wordmark-dark.png">
    <img src="assets/readme/wordmark-light.png" alt="Yalqen" width="300">
  </picture>

  <p>
    <strong>面向开发者的键盘优先 Chromium 浏览器。</strong><br>
    垂直标签页、快速命令栏、内置广告和跟踪器拦截，以及没有多余界面的开发者工具。
  </p>

  <p>
    <a href="https://yalqen.com/download"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-dmg-dark.png"><img src="assets/readme/download-dmg.png" alt="下载 DMG" width="250"></picture></a>
    <a href="#安装"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/install-homebrew-dark.png"><img src="assets/readme/install-homebrew.png" alt="使用 Homebrew 安装" width="250"></picture></a>
    <br>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://ysamed.github.io/yalqen/release-dark.svg"><img src="https://ysamed.github.io/yalqen/release-light.svg" alt="最新版本和总下载量" height="56"></picture></a>
  </p>

  <p>
    <sub>
      <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">官网</a> ·
      <a href="apps/browser/CHANGELOG.md">更新日志</a> ·
      <a href=".github/CONTRIBUTING.md">参与贡献</a> ·
      <a href="README.md">English</a> ·
      <a href="README.tr.md">Türkçe</a>
    </sub>
  </p>
</div>

<p align="center">
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme"><img src="assets/screenshots/website.webp" alt="Yalqen 官网：Light as paper. Clear as glass." width="900"></a>
</p>

## 功能

Yalqen 适合想要 Chromium 兼容性、又不想被浏览器界面干扰的开发者。

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/command-dark.zh-CN.svg"><img src="assets/readme/cards/command-light.zh-CN.svg" alt="命令栏" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/tabs-dark.zh-CN.svg"><img src="assets/readme/cards/tabs-light.zh-CN.svg" alt="垂直标签页" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/devtools-dark.zh-CN.svg"><img src="assets/readme/cards/devtools-light.zh-CN.svg" alt="开发者工具" width="268"></picture>
  <br>
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/blocking-dark.zh-CN.svg"><img src="assets/readme/cards/blocking-light.zh-CN.svg" alt="广告和跟踪器拦截" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/https-dark.zh-CN.svg"><img src="assets/readme/cards/https-light.zh-CN.svg" alt="仅 HTTPS 和安全 DNS" width="268"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/memory-dark.zh-CN.svg"><img src="assets/readme/cards/memory-light.zh-CN.svg" alt="内存节省" width="268"></picture>
</p>

查看全部[键盘快捷键](docs/keyboard-shortcuts.md)。Yalqen 还内置了七个搜索引擎。

## 帮助测试 Linux 并开发 Windows 支持

Yalqen 支持 macOS，现在也提供实验性的 Linux 预览版。欢迎在更多 Linux 发行版和桌面环境中测试、报告平台特定问题，或参与开发 Windows 支持。

感兴趣？请[创建 issue](https://github.com/YSamed/yalqen/issues/new)，说明你希望参与的平台以及可以提供的帮助。开始前可查看[贡献指南](.github/CONTRIBUTING.md)。

## Linux 预览版

[阅读公告并分享测试结果](https://github.com/YSamed/yalqen/discussions/280)。

感谢 [@Sathyabalan6](https://github.com/Sathyabalan6) 在 [#208](https://github.com/YSamed/yalqen/pull/208) 中贡献初步的 Linux 支持。在 Linux 上使用 Node.js 24，从 `main` 分支的源码构建实验性 AppImage：

```bash
cd apps/browser
npm ci
npm run package:linux
```

生成的 AppImage 位于 `apps/browser/release/`。Chromium 沙箱需要 Linux 允许使用非特权用户命名空间；Yalqen 会拒绝以 `--no-sandbox` 启动。目前已在 Ubuntu 和 GNOME Wayland 环境下进行初步测试。发布流程尚不提供 Linux 安装包，Linux 自动更新也尚未验证。

## 安装

### macOS

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/cards/requirements-dark.zh-CN.svg"><img src="assets/readme/cards/requirements-light.zh-CN.svg" alt="需要搭载 Apple Silicon 的 macOS 13 或更高版本，已签名并公证，自动更新" height="56"></picture>

```bash
brew install --cask YSamed/yalqen/yalqen
```

<sub>更喜欢磁盘映像？[下载最新 DMG](https://yalqen.com/download)。</sub>

<br>

<p align="center"><sub><a href="docs/README.zh-CN.md">技术细节</a> · <a href=".github/CONTRIBUTING.md">参与贡献</a> · <a href=".github/SECURITY.md">安全</a> · <a href="LICENSE">MIT 许可证</a></sub></p>

<p align="center"><sub>如果 Yalqen 对你有帮助，欢迎给仓库点个 Star，这能帮助更多开发者发现这个项目。</sub></p>
