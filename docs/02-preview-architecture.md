# TextOne 预览架构：现状拆解与新方案

> 对应基准：MiaoYan `main` @ `0f348ca9`
> 目标形态：Tauri 2 + React + CodeMirror 6，只做 macOS（Windows / Android 暂缓）

## 一、现在的预览是怎么实现的

一句话：**Markdown 在原生侧渲染成 HTML，WebView 只负责增强和显示；页面只加载一次，之后原地改 DOM。**

### 1. 五层分工

| 层 | 做什么 | 代码 |
|---|---|---|
| 渲染 | Markdown → HTML，输出 `data-sourcepos` | `Business/Markdown.swift` 的 `renderMarkdownHTML`，直接调 cmark-gfm C 库 |
| 模板 | 把 HTML 塞进 `index.html` 的占位符，写临时目录 | `Business/HtmlManager.swift` 的 `htmlFromTemplate` / `createTemporaryBundle` |
| 增强 | KaTeX、Mermaid、PlantUML、Markmap、highlight.js、TOC、图片放大 | `Resources/DownView.bundle/js/*` |
| 桥 | 页面与原生互发消息、滚动同步、媒体读取 | `Views/MPreviewView.swift`、`Views/MPreviewHandlers.swift` |
| 复用 | 导出 PDF/PNG/HTML、PPT 都走同一套页面与 CSS | `Extensions/MPreviewView+Export.swift`、`ppt.html` |

关键点：**渲染不在 JS 里做。** cmark-gfm 是 C 库，Swift 直接调；Rust 也可以直接 FFI 调同一个库，输出能逐字节一致。

### 2. 一次加载，之后原地更新

- 首次打开：`load(note:)` 在后台渲染，拼出整页 HTML，写到临时 bundle，`loadFileURL` 加载，且只给页面自己所在目录的读权限。
- 编辑时：`updateContent` 重新渲染，调 `MiaoYanCommon.patchContent(container, html)`，只替换 HTML 或行内布局变化的顶层块，其余块保留，滚动位置尽量不动。
- 切换笔记：`showNoteInPlace` 调 `MiaoYanCommon.showNote(html)`，不重载模板，所以没有白屏。
- 只有这些情况整页重载：预览样式变了（字体/宽度/字号）、进入 PPT、导出、页面还没加载完。

### 3. 原生与页面之间的六条通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `checkbox` | JS → 原生 | 预览里点任务复选框，回写 Markdown 源文件 |
| `previewScroll` | JS → 原生 | 上报当前顶部对应的源码行号 |
| `imageSize` | JS → 原生 | 图片加载完成后回传真实尺寸 |
| `imageProbe` | JS → 原生 | 未加载的远程图，请求原生探测头部尺寸 |
| `tocTipClicked` | JS → 原生 | 首次 TOC 提示被点掉 |
| `revealBackgroundColor` | JS → 原生 | PPT 幻灯片背景色同步到窗口 |

### 4. 滚动同步用源码行号，不用百分比

页面里查所有 `[data-sourcepos]` 元素，建 `{行号, top}` 索引；滚动时二分查找再线性插值，算出当前行（VS Code 的算法）。JS 把行号发给原生，原生再算编辑器的目标行；反向由原生发 `scrollToLine(line)`。

这就是为什么 cmark 必须带 `CMARK_OPT_SOURCEPOS`：没有它，双向同步只能按滚动比例猜，长图、代码块一多就会错位。

### 5. 本地媒体走自定义协议

App Store 版是沙盒的，Web 内容进程读不到笔记文件夹，`file://` 会让所有本地图片变空白（事故 I-43）。所以图片、视频、音频统一走 `miaoyan-file://`：

- 由 App 进程读文件，再把字节交给 WebView；
- 只服务图片和音视频类型，笔记里的 HTML 不能借它读别的文件；
- 支持 `Range`，视频才能起播和拖动。

### 6. 导出复用同一页面

PDF 用离屏 `WKWebView` 打印预览自己的 HTML，PNG 用快照，HTML 导出内嵌 CSS 与图片。所以预览的 CSS、图表等待逻辑、字体规则，和导出是同一份——改预览必须同时验导出。

## 二、新架构怎么接

### 结论

**用“预览岛”（preview island）：React 负责壳，预览那一块 DOM 由现有 runtime 独占。**

不要 iframe，也不要用 React 重写渲染。

```
React app
├── 侧栏 / 列表 / 设置 / 工具栏      ← React 管
└── <div ref={previewHost}>          ← React 只给容器，不进入子树
      └── preview runtime（复用 DownView.bundle）
            ├── theme CSS
            ├── common.js: showNote / patchContent / TOC / 图片占位
            └── diagram-handler.js + vendor JS
```

React 不给这个容器加任何子节点、不做 reconciliation；初始化时把 runtime 挂进去，之后只通过命令式 API（`showNote`、`patchContent`、`scrollToLine`）驱动。这是唯一能同时满足“复用现有 JS”和“渲染一致”的接法。

### 三个方案对比

| | A. 预览岛（推荐） | B. iframe 嵌 bundle | C. React 重写渲染 |
|---|---|---|---|
| 复用现有 JS | 全部，改桥接即可 | 全部，零改动 | 0，全部重写 |
| DOM/CSS 隔离 | 中，需要作用域化 | 强 | 强 |
| 滚动同步 | 同一滚动容器，最简单 | 跨 iframe，postMessage 有延迟 | 自己实现 |
| 性能 | 最好，单 WebView | Android 上嵌套浏览上下文偏重 | 取决于实现 |
| 改造成本 | 中 | 低 | 高 |
| 对等风险 | 低 | 低 | 高 |

iframe 适合在 M0 做“现有 bundle 能否原样跑”的对照验证，不适合作为最终形态。

### bundle 需要改的四处

1. **消息桥**：把 `window.webkit.messageHandlers.X.postMessage(payload)` 换成统一的 `bridge.post(name, payload)`。Tauri 下走 `invoke('preview_event', { name, payload })`，Web 调试下走 `window.postMessage`。六条通道的名字和载荷保持不变。
2. **媒体协议**：`miaoyan-file://` 换成 Tauri 的 `convertFileSrc()` / asset 协议。Rust 侧注册协议，保持现有的类型白名单与 `Range` 支持。macOS 上要验证 URL 形态、MIME 与 `Range` 三项。
3. **滚动容器**：现在所有脚本操作 `window.scrollTo` / `document.scrollingElement`。React 布局里预览区是一个独立滚动容器，要改成对宿主元素 `scrollTop` 操作，滚动监听也挂在宿主上。
4. **CSS 作用域**：`html, body` 的规则改成 `#preview-root`，否则会把 React 壳一起刷成纸色；主题从 `<html class="darkmode">` 改成宿主上的 `data-theme`，避免和壳的主题类打架。

### 页面生命周期可以更简单

现在每次 `load(note:)` 都要拼整页 HTML、写临时文件、`loadFileURL`，因为 CSS 和标题是编译进页面的。新架构可以只加载一次静态 `preview.html`：

- 主题、字体、宽度全部用 CSS 变量在宿主上切换；
- 标题用 `document.title` 或宿主属性；
- 之后只调 `showNote` / `patchContent`。

这样能去掉临时目录、`loadEpoch` 竞争和一半的加载态 bug。

## 三、平台差异（暂不做，留档）

当前只做 macOS，这一节不实施。留在这里，是因为预览层的 CSS 与协议最容易在跨端时返工，先记下差异，以后立项时不用重新踩。

### WebView 内核

| 平台 | 内核 | 注意 |
|---|---|---|
| macOS | WKWebView（Safari） | 和现在一致，风险最低 |
| Windows | WebView2（Chromium） | 字体渲染、滚动条、`backdrop-filter` 与 macOS 不同 |
| Android | System WebView（Chromium，版本碎片化） | 旧设备可能停在 Chromium 100 左右；软键盘 resize 行为不一致 |

KaTeX、Mermaid、highlight.js 在三端都能跑，但要按平台做 CSS 覆盖：

- `-webkit-font-smoothing` 只在 macOS 生效；
- `100vh` 在 Android 软键盘弹出时会变，改用 `100dvh` + `visualViewport`；
- `backdrop-filter` 在低端 Android 上开销大，TOC、查找栏这类浮层改用不透明底；
- 字体：Android 没有 PingFang，中文界面与预览要内置一份子集字体（Noto Sans SC / 思源黑体），否则 fallback 不可控，导出也会变。

### 文件与协议

| 能力 | macOS | Windows | Android |
|---|---|---|---|
| 目录授权 | security-scoped bookmark | 普通路径 | SAF tree URI + 持久授权 |
| 文件监听 | FSEvents | ReadDirectoryChangesW | SAF 无可靠监听，前台重扫 + 生命周期回调 |
| 删除 | 系统 Trash | 回收站 | App 内 Trash 目录 |
| 本地媒体 | 自定义 scheme | asset 协议 | asset 协议 + ContentResolver |
| PDF 导出 | WKWebView 打印 | WebView2 `PrintToPdf` | PrintManager，分页不可控 |

Android 的文件层不是“Tauri 换个 target”就能解决：SAF 返回的是 content URI，不是路径，Rust 侧需要 Kotlin 插件 + JNI 才能遍历和读写。这是独立的一块工程。

### 布局

Android 手机不能照搬三栏。需要新增：

- 手机：文件夹抽屉 → 笔记列表 → 编辑器 两级导航，返回键逐级回退；
- 平板：列表 + 编辑器两栏，文件夹用抽屉；
- 软键盘弹出时编辑器高度、光标可见性、底部工具栏避让；
- 触控替代 hover：长按出上下文菜单，滑动返回，点击目标不小于 44pt。

这些是新增功能，不在原 124 项里，已在 `01-feature-inventory.md` 的附录 A 留档。

## 四、M0 要验证的四件事（macOS）

1. 现有 `DownView.bundle` 在 Tauri 的 macOS WKWebView 里能否原样渲染一篇含 Mermaid、KaTeX、本地图片的笔记。
2. `patchContent` 在 React 容器里是否仍然只动预览子树，不碰壳。
3. 滚动同步在预览岛里能否稳定在 60fps，长笔记与多图笔记是否掉帧。
4. asset 协议在 macOS 上是否支持 `Range` 与正确 MIME，视频能否起播。

四项都过，再谈 M1；任何一项不过，先改方案，不要往上堆功能。
