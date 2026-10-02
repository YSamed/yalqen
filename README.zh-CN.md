<div align="center">
  <img src="design/brand/png/icon-256.png" alt="Yalqen" width="112">

  <h1>Yalqen</h1>

  <p><strong>面向 macOS 开发者的键盘优先 Chromium 浏览器。</strong></p>
  <p>垂直标签页、快速命令栏、内置广告和跟踪器拦截，以及没有多余界面的开发者工具。</p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><img src="design/readme/download-button.png" alt="下载 macOS 版" width="260"></a>
  </p>

  <p>
    <a href="https://github.com/YSamed/yalqen/releases/latest"><strong>下载</strong></a> ·
    <a href="#安装">Homebrew</a> ·
    <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">官网</a> ·
    <a href="apps/browser/CHANGELOG.md">更新日志</a> ·
    <a href="CONTRIBUTING.md">参与贡献</a> ·
    <a href="README.md">English</a> ·
    <a href="README.tr.md">Türkçe</a>
  </p>
</div>

<p align="center">
  <a href="https://yalqen.com/?utm_source=github&amp;utm_medium=readme">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="design/screenshots/website-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="design/screenshots/website-light.png">
      <img src="design/screenshots/website-light.png" alt="Yalqen 官网" width="900">
    </picture>
  </a>
</p>

## 为什么选择 Yalqen？

Yalqen 适合想要 Chromium 兼容性、又不想被浏览器界面干扰的开发者。

- **默认键盘优先。** 通过命令栏打开标签页、搜索、导航和执行操作。
- **垂直标签页不占用内容空间。** 固定标签页、地址栏和窗口控制集中在一个紧凑的面板中。
- **面向开发者的工作流。** 内置 Chromium DevTools，一键切换手机视图，方便响应式测试。
- **内置隐私功能。** 开箱即用的广告和跟踪器拦截、第三方 Cookie 拦截、仅 HTTPS 模式和安全 DNS。
- **开源且易于审查。** Yalqen 采用 MIT 许可证，公开开发。

<p align="center">
  <img src="design/readme/feature-command-bar.png" alt="命令栏" width="188">
  <img src="design/readme/feature-pinned-tabs.png" alt="固定标签页" width="173">
  <img src="design/readme/feature-developer-tools.png" alt="开发者工具" width="200">
  <img src="design/readme/feature-ad-blocking.png" alt="广告和跟踪器拦截" width="240">
</p>

## 功能

- **垂直标签页**：固定标签页、地址栏和窗口控制集中在一个面板
- **命令栏**：键盘优先的导航和操作（[键盘快捷键](docs/keyboard-shortcuts.md)）
- **广告和跟踪器拦截**：内置过滤引擎，另有第三方 Cookie 拦截
- **仅 HTTPS 模式**和**安全 DNS**
- **开发者工具**和一键**手机视图**
- **内存节省**和七个内置搜索引擎

> 如果 Yalqen 对你有帮助，欢迎给仓库点个 Star，这能帮助更多开发者发现这个项目。

## 安装

> **需要 macOS 13 或更高版本，且仅支持 Apple Silicon。** 不支持 Intel Mac。

使用 [Homebrew](https://brew.sh)：

```bash
brew install --cask YSamed/yalqen/yalqen
```

或从 [Releases](https://github.com/YSamed/yalqen/releases/latest) 下载 DMG。应用已使用 Developer ID 签名并经过公证，打开时不会出现 Gatekeeper 警告。

下载徽章统计 DMG 文件下载次数，包含重复下载。活跃安装徽章统计过去 30 天内参与统计的浏览器配置文件，不代表独立用户人数。活跃安装统计默认关闭，可在 **设置 → 隐私** 中开启。非隐私窗口打开时，每个 UTC 日期最多发送一次随机安装 ID。[统计方式详情](docs/usage-measurement.md)。

Yalqen 会在后台自动更新。如需通过 Homebrew 更新：

```bash
brew upgrade --cask yalqen
```

卸载并删除其数据：

```bash
brew uninstall --zap --cask yalqen
```

## 开发

应用位于 `apps/browser`，需要 Node.js 22.12 或更高版本。

```bash
cd apps/browser
npm ci
npm start
```

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

- Yalqen 基于 [MIT 许可证](LICENSE)发布。
- 内置的过滤列表保留各自的许可证，详见 [THIRD_PARTY_NOTICES.md](apps/browser/THIRD_PARTY_NOTICES.md)。
- Yalqen 名称和标志不在 MIT 许可证范围内。
