# Juejin article (draft)

Platform: 掘金 (juejin.cn). The same text works on Zhihu with minor edits. Publish after the V2EX post, not the same day.

Before publishing:

- Fill every `【待补充】` marker with your own experience; the parts that need your own story are marked on purpose and nothing was invented.
- Benchmark numbers come from a single preliminary run (see [../benchmarks.md](../benchmarks.md)); rerun the default three runs before publishing and update the table.
- Have a Chinese speaker read it once.
- Suggested tags: `Electron`, `Chromium`, `开源`, `macOS`, `前端`.
- Cover image: `design/screenshots/website-light.png`.

---

**Title:**

```
用 Electron 做一个浏览器：我踩过的几个坑
```

**Summary (摘要, one line for the Juejin form):**

```
一个人用 Electron 做 macOS 开发者浏览器 Yalqen 的经验：窗口管理、广告拦截、内存节省、扩展、签名公证，以及 Electron 的真实代价。
```

**Body:**

````markdown
我一直想要一个"键盘优先"的浏览器：标签页、搜索、DevTools 都不用碰鼠标，界面还要尽量不占地方。Arc 证明了浏览器界面可以做得更好，但它不开源。所以我用 Electron 做了 [Yalqen](https://github.com/YSamed/yalqen)，一个 MIT 开源、面向 macOS 开发者的 Chromium 浏览器。

这篇文章不讲"怎么用 Electron 包一个网页"，只讲做浏览器时比预期更难的几个部分，以及 Electron 在这件事上的真实代价。

## 为什么选 Electron

一个人要做出可用的浏览器，Electron 给了很多现成的东西：完整的 Chromium、多进程模型、DevTools、扩展支持、自动更新。精力可以花在浏览器的行为上，而不是引擎的胶水代码。

另外，它就是 Chromium，Chrome 能打开的网站 Yalqen 也能打开。面向开发者的浏览器承受不起渲染差异。

界面部分用的是 Svelte 5 + TypeScript，带热更新，试一个想法只要几分钟。

## 1. 浏览器本质上是窗口管理

每个标签页都是一个独立的 WebContents，放在界面旁边；而界面本身也是一个网页。

最先遇到的难题是：在多个独立的 WebContents 之间，让焦点、快捷键、浮层（命令栏、查找栏、弹窗）的行为保持一致。键盘事件到底发给谁、浮层盖在谁上面，这些在普通网页里不存在的问题，在这里都要自己处理。

【待补充：一个具体的 bug 和修复过程，例如焦点被抢走、浮层层级、快捷键路由。】

## 2. 在主进程里做广告拦截

我用的是 `@ghostery/adblocker-electron`：把过滤规则编译成引擎，在请求发出前就拦截。

几个要点：

- 启动成本：每次启动都解析规则列表太慢，所以把编译好的引擎缓存成二进制，启动时直接加载。
- 网络拦截和元素隐藏（cosmetic filtering）是两回事，有些网站会因为规则而坏掉，需要能按站点关闭。
- 对开发者来说，"看看没有拦截器的用户看到的页面"是刚需，所以支持按站点例外。

拦截的好处是双向的：被拦截的广告和跟踪器根本不会加载，所以也省内存。

## 3. 内存节省：卸载标签页，但不丢数据

Electron 没有 Chrome 那样的标签页丢弃机制，所以我自己做了：闲置一段时间的标签页会被卸载，回来时重新加载。

最关键的是"哪些标签页绝对不能卸载"：

- 当前标签页和固定标签页
- 正在播放音频的标签页
- 开着 DevTools 的标签页
- 有未提交输入（表单还没发送）的标签页
- 还在加载中的标签页

策略是定时卸载（默认 30 分钟，可选 15/30/60/120 分钟或关闭），同时响应 macOS 的内存压力：压力大时，优先卸载最久没用的闲置标签页。

卸载时并不是简单地销毁页面：先把标签页的导航历史（所有条目和当前位置）保存下来，再销毁视图；用户切回来时，通过 `navigationHistory.restore` 把历史还原，这样后退/前进列表还在。如果还原失败，就退回到重新加载该标签页的地址。

"有未提交输入"这个判断也很朴素：监听页面的 `char` 键盘输入，只要用户在页面里打过字就标记为"已编辑"，页面导航后清除标记。宁可少卸载，也不丢用户正在写的内容。

### 实测数据（初步）

在我的 MacBook Air（M4，16 GB）上，用相同的真实网页对比 Yalqen 和 Chrome，内存按整个进程树的 `phys_footprint` 之和计算（也就是活动监视器里的"内存"），标签页打开 60 秒后测量：

| 标签页 | Yalqen（开启拦截） | Yalqen（关闭拦截） | Chrome |
| ------ | ------------------ | ------------------ | ------ |
| 10     | 920 MB             | 1057 MB            | 1583 MB |
| 20     | 1548 MB            | 1796 MB            | 2819 MB |
| 40     | 2802 MB            | 3237 MB            | 5312 MB |

相同页面下，Yalqen 的内存约为 Chrome 的 53–58%（开启拦截）。仅广告拦截就节省了 13–14%。

需要说明的是：

- 这是**单次运行的初步结果**，不是最终结论。
- 我没有测页面加载速度、启动时间、滚动/渲染性能和电池消耗，这些数据不能说明 Yalqen 更快。
- 空闲 CPU 上 Chrome 看起来高出很多，但我怀疑是因为测试用的 Chrome 配置文件刚创建，后台任务还没跑完，所以不拿这个比值说事。
- 测试脚本是开源的（`apps/browser/scripts/bench-browsers.mjs`），欢迎复现和指出问题。

## 4. Chrome 应用商店扩展

Electron 只实现了 Chrome 扩展 API 的一个子集。从应用商店安装扩展，意味着自己下载并解包 CRX 文件。内容拦截器和简单的扩展可以用，依赖 Electron 没有的 API 的扩展就不行。

应用商店页面上的"添加到 Chrome"按钮依赖 `chrome.webstorePrivate` 这组只有 Chrome 才有的私有 API，Electron 里并不存在。我的做法是：

- 在应用商店页面注入一个 preload，用 `contextBridge` 暴露一个桥，在页面里补上 `chrome.webstorePrivate` 的垫片（shim），按钮点击后走自己的安装流程。
- 校验扩展 ID（32 位 a–p 字符），再从 Google 的更新服务按 `crx3` 格式下载。
- 解析 CRX 文件头（支持 CRX2 和 CRX3），去掉签名头只保留 ZIP 内容，限制大小为 128 MB，解包后加载。

【待补充：你实际测试过的扩展里，哪些能用、哪些不能用。】

## 5. 签名、公证和自动更新

这一块比我预想的花了更多时间：

- **证书名含非 ASCII 字符。** 我的名字里有 "ş"，`codesign` 按名字匹配证书失败，最后改成按证书哈希签名。
- **CI 里的钥匙串。** 把证书导入一个专用钥匙串，避免 electron-builder 在 CI 里卡住。
- **公证。** 使用 App Store Connect API Key。
- **自动更新。** 用 electron-updater。Squirrel.Mac 只接受由同一个 Developer ID 签名的更新，所以最早那些 ad-hoc 签名的版本永远无法自我更新。
- **发布自动化。** release-please 管理版本和变更日志，并生成构建来源证明（provenance attestation）。

## 6. 加固 Electron 应用

打包后的应用使用 Electron fuses：禁用 `runAsNode`、`NODE_OPTIONS` 和 `--inspect`，并且只加载经过完整性校验的 `app.asar`。

所有 WebContents（标签页、界面、浮层、扩展弹窗）都开启了 `sandbox: true` 和 `contextIsolation: true`，并且关闭了 `nodeIntegration`。网页只拿到一个很小的 page preload，界面、命令栏、查找栏、应用商店各有自己独立的 preload，只通过 `contextBridge` 暴露需要的少量接口，互不共享。

## Electron 的真实代价

不想只说好话，这些都是实际的权衡：

- **内存开销。** 界面本身也是一个网页，所以比原生浏览器多一个渲染进程。空闲窗口下界面部分约 120 MB。
- **安装包体积。** DMG 约 120 MB，因为每个 Electron 应用都自带 Chromium。
- **Chromium 版本滞后。** Electron 的发布晚于 Chrome 稳定版，安全修复要等 Electron 的补丁版本。
- **没有 DRM。** 原版 Electron 不带 Widevine，Netflix 这类受 DRM 保护的流媒体无法播放。
- **扩展支持不完整。**
- **不是原生 Mac 应用。** 菜单、窗口和输入框接近原生，但不是 AppKit，服务（Services）、部分无障碍细节和 Handoff 等 macOS 行为缺失或只是近似。

## 接下来：CEF + AppKit？

长期方案是继续用 Chromium，但改用 CEF（Chromium Embedded Framework），界面用 AppKit 原生重写。好处是去掉界面这个额外的渲染进程、获得真正的 AppKit 行为、可以控制 Chromium 版本和 Widevine。代价是界面要从 Svelte 重写成 Swift/Objective-C，迭代变慢，CEF 在扩展等方面暴露的能力比 Electron 少，构建和升级 Chromium 也更重。

【待补充：你目前的决定，以及触发切换的条件。】

在那之前 Electron 会继续用下去，目标是先把 Yalqen 做到值得现在就用，并诚实地测量 Electron 到底在哪里拖了后腿。

## 最后

Yalqen 是 MIT 开源的，代码都在这里：https://github.com/YSamed/yalqen

安装（macOS 13+，仅支持 Apple Silicon）：

```bash
brew install --cask YSamed/yalqen/yalqen
```

已有简体中文 README。如果对你有帮助，欢迎点个 Star，也欢迎提 issue 和 PR，尤其是中文输入法（IME）和快捷键设计方面的反馈。
````
