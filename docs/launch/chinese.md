# Chinese-language launch posts (drafts)

Audience: Chinese-speaking developers, reached on 2026-09-30 through a post by @jaywcjlove. Post one platform per day, never the same text twice. Read each platform's rules before posting; they change often. Disclose that you are the developer.

Links use `utm_source` so traffic can be told apart in the website analytics.

---

## V2EX (node: 分享创造)

**Title:**

```
[开源] Yalqen：给 macOS 开发者的键盘优先 Chromium 浏览器（垂直标签页 + 命令栏 + 内置去广告）
```

**Body:**

```
大家好，我是 Yalqen 的作者。

Yalqen 是一个基于 Chromium（Electron）的 macOS 浏览器，MIT 开源，免费。起因很简单：我每天在浏览器里花的时间很多，但标签页、搜索、DevTools 这些操作都离不开鼠标，想要一个键盘优先、界面尽量不占地方的浏览器。

主要特性：

- 垂直标签页：固定标签页、地址栏、窗口控制集中在一个窄面板里，内容区更大
- 命令栏：打开标签页、搜索、跳转、执行操作都可以用键盘完成
- 内置广告和跟踪器拦截、第三方 Cookie 拦截、仅 HTTPS 模式、安全 DNS
- 内置 Chromium DevTools，一键切换手机视图（带设备预设），方便测响应式
- 内存节省（自动卸载闲置标签页）、支持 Chrome 应用商店扩展、页面翻译

安装（需要 macOS 13+，仅支持 Apple Silicon）：

    brew install --cask YSamed/yalqen/yalqen

也可以直接从 Releases 下载 DMG，已签名并公证。

GitHub：https://github.com/YSamed/yalqen
官网：https://yalqen.com/?utm_source=v2ex

目前还很早期，欢迎提 issue 和建议，尤其是快捷键设计、中文输入法（IME）相关的问题，我会认真看。
```

---

## 掘金 / 知乎 (technical article)

**Title:**

```
用 Electron 做一个浏览器：我踩过的几个坑
```

**Outline** (fill the TODO parts with your own numbers; the English outline is in [blog-post.md](blog-post.md)):

```
1. 为什么做一个浏览器，为什么选 Electron（真实的 Chromium、DevTools、自动更新）
2. 浏览器本质上是窗口管理：每个标签页是独立的 WebContents，焦点、快捷键、浮层（命令栏、查找栏）的一致性是第一个难点
3. 主进程里的广告拦截：编译过滤规则为二进制缓存，避免每次启动都解析；网络拦截 vs 元素隐藏
4. 内存节省：哪些标签页绝不能卸载（当前页、固定页、播放音频、开着 DevTools、有未提交输入）；定时卸载 + 响应 macOS 内存压力
5. Chrome 应用商店扩展：Electron 只支持部分扩展 API，哪些能用、哪些不能
6. 签名、公证和自动更新：证书名里含非 ASCII 字符（"Yaşar"）导致 codesign 匹配失败，改用证书哈希签名
7. 结尾：项目地址和欢迎反馈
```

Closing paragraph:

```
Yalqen 是 MIT 开源的，代码都在这里：https://github.com/YSamed/yalqen
如果对你有帮助，欢迎点个 Star，也欢迎提 issue 和 PR。
```

---

## Short pitch for X / Weibo

```
Yalqen：面向 macOS 开发者的开源 Chromium 浏览器。
垂直标签页、键盘优先的命令栏、内置去广告和跟踪器拦截、一键手机视图。MIT 协议，免费。
brew install --cask YSamed/yalqen/yalqen
https://github.com/YSamed/yalqen
```

---

## Other places to submit (check each one's rules)

- 阮一峰《科技爱好者周刊》: accepts project suggestions through the GitHub issues of `ruanyf/weekly`
- HelloGitHub (月刊): submit through the project's "Submit" form on hellogithub.com
- 小众软件 (appinn.com): accepts tips for useful apps
- 少数派 (sspai.com): Matrix posts about tools
