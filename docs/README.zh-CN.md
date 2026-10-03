# 技术细节

<p>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/ci.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml"><img src="https://github.com/YSamed/yalqen/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/YSamed/yalqen"><img src="https://api.scorecard.dev/projects/github.com/YSamed/yalqen/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://yalqen.com/privacy#active-installations"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fyalqen.com%2Fapi%2Fusage" alt="Active installations in the last 30 days, opt-in only"></a>
</p>

[README](../README.zh-CN.md) · [English](README.md) · [Türkçe](README.tr.md) · 简体中文

## 系统要求

搭载 Apple Silicon 的 macOS 13 Ventura 或更高版本。不支持 Intel Mac。

## 安装

使用 [Homebrew](https://brew.sh)：

```bash
brew install --cask YSamed/yalqen/yalqen
```

或从 [Releases](https://github.com/YSamed/yalqen/releases/latest) 下载 DMG。应用已使用 Developer ID 签名并经过公证，打开时不会出现 Gatekeeper 警告。

## 更新

Yalqen 会在后台检查更新，并在重启时安装。如需通过 Homebrew 更新：

```bash
brew upgrade --cask yalqen
```

## 卸载

使用 Homebrew 卸载并删除其数据：

```bash
brew uninstall --zap --cask yalqen
```

不使用 Homebrew 时，退出 Yalqen 并将其移到废纸篓。配置文件数据位于 `~/Library/Application Support/yalqen-electron-prototype`。

## 使用统计

活跃安装统计默认关闭，可在 **设置 → 隐私** 中开启。开启后，非隐私窗口打开时，每个 UTC 日期最多发送一次随机安装 ID。README 中的下载量包含重复下载，两个计数器都不代表独立用户人数。[统计方式详情](usage-measurement.md)。

## 开发

应用位于 `apps/browser`，需要 Node.js 22.12 或更高版本。

```bash
cd apps/browser
npm ci
npm start
```

| 命令                  | 作用                           |
| --------------------- | ------------------------------ |
| `npm run check`       | Lint、格式检查、类型检查和测试 |
| `npm test`            | 仅运行测试                     |
| `npm run bench`       | 启动、页面加载和空闲性能测试   |
| `npm run package:mac` | 构建 macOS 应用包              |

Git hooks、提交信息和 Pull Request 流程请阅读 [CONTRIBUTING.md](../.github/CONTRIBUTING.md)。

## 延伸阅读

- [键盘快捷键](keyboard-shortcuts.md)
- [为什么选择 Electron？](decisions/why-electron.md)
- [架构](architecture.md)
- [基准测试](benchmarks.md)
- [下载和活跃安装统计](usage-measurement.md)
- [安全策略](../.github/SECURITY.md)

## 许可证

- Yalqen 基于 [MIT 许可证](../LICENSE)发布。
- 内置的过滤列表保留各自的许可证，详见 [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md)。
- Yalqen 名称和标志不在 MIT 许可证范围内。
