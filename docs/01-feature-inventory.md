# TextOne · 功能全集、优先级与 MVP

> TextOne 是 MiaoYan 的 Rust 重写，独立目录 `~/Desktop/rico/TextOne`，与 `MiaoYan` 同级。
> 基准：`tw93/MiaoYan` `main` @ `0f348ca9`（V4.10.0，2026-11-20 冻结，不再跟进上游）
> 形态：Tauri 2 + React + CodeMirror 6 + 系统 WebView
> 平台：macOS 14+（单平台；Windows / Android 暂不做，需求留档在附录 A）
> 验收口径：**功能对等**。像素与文本手感按“接近”验收，不按逐像素。

**已定决策（2026-11-20）**

- 项目名：TextOne
- 目录：`~/Desktop/rico/TextOne`，与 MiaoYan 同级，完全独立
- 外壳：Tauri 2
- 编辑器：CodeMirror 6
- 预览：预览岛，复用 `Resources/DownView.bundle`，见 `02-preview-architecture.md`
- 分发：macOS DMG + Tauri updater（Mac App Store 待定）
- 平台：只做 macOS；Windows 和 Android 暂缓
- 基准：冻结当前 commit，不跟上游

## 0. 先划四条边界

1. **编辑器不可能和 NSTextView 完全一致。** React 路线意味着文本编辑交给 CodeMirror 6。原生右键菜单、输入法候选窗位置、撤销粒度、选区分词都会变。这是路线选择带来的固有代价，不是实现问题。
2. **预览层不是“重写”，是“接线”。** `Resources/DownView.bundle/` 里的 KaTeX、Mermaid、PlantUML、Markmap、highlight.js、TOC、Reveal 可以整份复用。所以数学、图表、代码高亮这些看似很重的功能，边际成本接近零；真正的工作量在 WebView 与 Rust 的桥接、增量更新和滚动同步。
3. **系统集成决定“像不像原生应用”。** 原生菜单、全局快捷键、废纸篓、沙盒书签、PDF 打印、文件关联，这些在 Rust 侧都要单独接，不能靠前端模拟。
4. **收窄到 macOS 降低了风险，不是缩小了目标。** Tauri 在 macOS 上用 WKWebView，和现在的预览引擎同一内核，预览与 PDF 导出最容易对齐。先把 macOS 做到能日常使用，跨端等这一版稳定后再谈。

## 1. 优先级定义

| 级别 | 含义 | 判断标准 |
|---|---|---|
| **P0** | MVP 必须 | 缺了这一项，用户无法完成“打开库 → 写 → 看 → 搜 → 存”的闭环 |
| **P1** | 1.0 对等发布 | 缺了不算完整产品，但可以在 MVP 之后补 |
| **P2** | 长尾与差异化 | 用的人少，或依赖特定系统能力，可以最后做 |

## 2. 功能全集

### A. 笔记库与文件

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| A1 | 选择任意本地文件夹作为笔记库，重启后保持授权 | `Business/Storage.swift`、`UserDefaultsManagement.storageBookmark` | P0 | 目录选择 + 持久化授权；macOS 需 security-scoped bookmark |
| A2 | 多级文件夹树，递归扫描，符号链接不重复不递归 | `Storage.loadProjects` / `checkSub` | P0 | 递归 + realpath 去重 |
| A3 | All Notes 聚合全部笔记 | `Storage`、侧栏品牌行下 | P0 | |
| A4 | 笔记就是 `.md` / `.markdown` / `.txt` 文件，标题取文件名 | `Business/Note.swift` | P0 | 不引入数据库，保持可迁移 |
| A5 | 新建笔记，自动命名并去重编号 | `Storage` 新建流程 | P0 | |
| A6 | 新建 / 重命名 / 移动 / 删除文件夹 | `Storage.moveFolder`、侧栏 | P1 | 拒绝移入自身子目录、同名、附件目录 |
| A7 | 重命名笔记（标题即文件名，255 字节上限） | `Note.renameFile` | P0 | |
| A8 | 制作副本（⌘D） | `ViewController+Action.duplicate` | P1 | |
| A9 | 移到废纸篓、恢复、清空 | `Storage.trashItem`、`TrashReturn` | P0 | 走系统 Trash，保持可恢复 |
| A10 | 应用内 `Trash` 文件夹（跨设备可见） | `Storage.checkLibraryTrash` | P1 | 与系统 Trash 语义区分，只有笔记进去 |
| A11 | 单文件模式（⌘O）与 `Opened` 临时列表 | `Storage.openedNotes` | P1 | 外部文件不改库 |
| A12 | 导入 Markdown 文件 / 文件夹 | `ViewController+Action.importFiles` | P1 | |
| A13 | 附件：`i/` 图片、`files/` 其他，粘贴或拖入自动复制 | `Helpers/ClipboardManager.swift` | P0 | MVP 先图片，任意文件 P1 |
| A14 | 清理未使用附件 | `Storage.findOrphanAttachments` | P2 | 有笔记读不出来时必须放弃清理 |
| A15 | iCloud 云盘可用性与同步状态 | `Business/CloudSyncManager.swift` | P2 | |
| A16 | 外部修改检测与冲突备份 | `Helpers/FileSystemEventManager.swift` | P1 | MVP 至少做保存前 mtime 校验 |
| A17 | 1.5s 防抖保存 + 原子写 + 失败提示 | `Note.executeSave` | P0 | 临时文件 + rename；失败不清 buffer |
| A18 | 只读保护：读取失败 / 编码异常 / 文件消失 | `Note.loadFailed` | P0 | fail-closed，绝不空写覆盖 |
| A19 | 版本历史（5 分钟节流、最多 20 版、diff、恢复） | `Business/NoteVersionManager.swift` | P1 | |
| A20 | 单实例、关窗重开、Dock 菜单 | `Controllers/AppDelegate.swift` | P1 | |

### B. 笔记列表与组织

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| B1 | 三栏布局，侧栏 / 列表可折叠，宽度记忆 | `ViewController+Layout` | P0 | |
| B2 | 列表行：标题、正文摘要、修改日期 | `Views/NoteCellView.swift` | P0 | |
| B3 | 排序：修改时间 / 创建时间 / 标题，升序降序 | `ViewController+Data` | P0 | MVP 先支持修改时间 |
| B4 | 置顶笔记 | `Note.pinned` | P1 | 排序要叠加置顶 |
| B5 | 笔记右键菜单（置顶/重命名/副本/删除/移动/显示/拷贝路径/导出/版本历史） | `Main.storyboard` | P1 | |
| B6 | 文件夹右键菜单（子文件夹/重命名/显示/终端/移动/删除） | `Views/SidebarProjectView.swift` | P1 | |
| B7 | 拖拽：跨文件夹移动、从 Finder 导入、拖出到 Finder | 两个侧栏 / 列表 | P1 | 拖出到 Finder 只有 SwiftUI 外壳支持 |
| B8 | 空状态提示 | | P1 | |
| B9 | 搜索结果作为列表态 | `filteredNoteList` | P0 | |
| B10 | 上下键切换笔记 | `NotesTableView` | P0 | |

### C. 编辑器

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| C1 | 纯文本 Markdown 编辑 | `Views/EditTextView.swift` | P0 | CodeMirror 6 建议 |
| C2 | 实时语法高亮（标题/强调/链接/列表/引用/代码/HTML/数学） | `Helpers/MarkdownRuleHighlighter.swift` | P0 | CM6 decoration；规则全集 P1 |
| C3 | 大文本性能降级（>1MB、>64KB 单段、>5000 行、>2000 行） | `Helpers/NotesTextProcessor.swift` | P1 | 先实测 CM6 上限再定阈值 |
| C4 | 中文输入法与候选窗 | NSTextView | P0 | CM6 的 IME 表现是硬门槛 |
| C5 | 回车续行（列表/任务/引用/编号），两次回车退出 | `MiaoYanCore.ListContinuation` | P0 | 纯逻辑，可 1:1 移成 Rust |
| C6 | Tab 缩进 / Shift-Tab 反缩进，编号列表对齐 | `Helpers/TextFormatter.swift` | P0 | |
| C7 | `/time` `/table` `/img` `/video` `/mermaid` 等快捷输入 + Tab 展开 | `ShortcutTemplateManager` | P1 | |
| C8 | 自动排版（Prettier） | `MarkdownFormatWorker` | P1 | Rust 侧需跑 Prettier（JSC 或 sidecar） |
| C9 | 清理排版（Typography） | `Helpers/TypographyCleaner.swift` | P1 | 纯逻辑，可移植 |
| C10 | 格式命令：粗体/斜体/下划线/删除线/链接/待办/行内代码/代码块 | `EditTextView` | P0 | MVP 先做粗斜体、链接、行内代码 |
| C11 | 撤销 / 重做（含格式化后的撤销） | NSTextView | P0 | CM6 history |
| C12 | 查找替换（当前笔记） | `EditTextView` 搜索 | P1 | |
| C13 | 粘贴转换：HTML → Markdown、纯文本 | `Helpers/HtmlToMarkdown.swift` | P1 | |
| C14 | 拖放文件 / 图片到光标位置 | `ClipboardManager.dropFiles` | P0 | MVP 先图片 |
| C15 | 粘贴图片上传 PicGo / PicList / uPic / Picsee | `ClipboardManager` | P2 | 本地 HTTP + shell 调用 |
| C16 | ⌘ 悬停预览图片 | `Helpers/ImagePreviewManager.swift` | P2 | |
| C17 | 链接：编辑 / 移除 / 点击打开 / 双链跳转 | `EditTextView.linkMenu` | P1 | |
| C18 | 字号缩放 ⌘= / ⌘- / ⌘0（12–28） | `ViewController+Editor` | P1 | |
| C19 | 光标与滚动位置按笔记记忆 | `AppContext.sessionState` | P1 | |
| C20 | 拼写检查默认关闭 | `EditTextView` | P0 | Web 编辑器默认无，需确认不误开 |
| C21 | 复制为 Markdown / 纯文本 / HTML | `ClipboardManager.handleCopy` | P2 | |
| C22 | 文档内标题补全 | `EditTextView.completions` | P2 | |

### D. 预览与渲染

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| D1 | 编辑 / 预览切换（⌘3） | `ViewController+Editor` | P0 | |
| D2 | 分栏 + 双向滚动同步 | 同上 | P0 | 60fps 是验收项 |
| D3 | 增量更新 DOM，不整页重载 | `patchContent` | P0 | |
| D4 | 切换笔记不重载模板 | `showNoteInPlace` | P1 | |
| D5 | GFM：表格 / 任务列表 / 删除线 / 自动链接 | `Business/Markdown.swift` | P0 | |
| D6 | 数学：KaTeX，行内 + 块级，`\$` 转义 | `DownView.bundle` | P0 | 随 bundle 复用，边际成本近零 |
| D7 | 图表：Mermaid（含 ELK）、PlantUML、Markmap | 同上 | P0 | 同上 |
| D8 | 代码高亮（highlight.js，浅/深主题） | 同上 | P0 | 同上 |
| D9 | GitHub Alerts 五种（NOTE/TIP/IMPORTANT/WARNING/CAUTION） | `Markdown.swift` + CSS | P1 | |
| D10 | YAML frontmatter 隐藏 | `MiaoYanCore.Frontmatter` | P1 | 只有 `key: value` 块才隐藏 |
| D11 | 本地图片 / 视频 / 音频，加载前预占尺寸 | `Business/PreviewMedia.swift`、`LocalMediaSchemeHandler` | P0 | MVP 先图片；媒体走自定义协议 |
| D12 | 远程图片尺寸探测 | `RemoteImageProbe` | P2 | |
| D13 | 图片点击放大 | `lightense` | P1 | |
| D14 | 视频首帧、延迟加载 | `PreviewMedia` | P2 | |
| D15 | 预览里点复选框，回写 Markdown | `HandlerCheckbox` | P1 | |
| D16 | TOC 大纲（⌘5，自动生成，悬浮把手，首次提示） | `MiaoYanTOC` | P1 | |
| D17 | 预览内查找替换 | `MPreviewView+Search` | P1 | |
| D18 | 标题锚点 hover 链接 | `base.css` | P2 | |
| D19 | 主题：浅色 / 深色 / 跟随系统 | `theme-*.css` | P0 | |
| D20 | 预览字体、代码字体、正文宽度、字号 | `FontCatalog` | P0 | MVP 先用默认字体栈 |
| D21 | 滚动位置保持 | | P1 | |
| D22 | PPT 演示（⌘4 / ⌥⌘P，Reveal.js，Esc 退出） | `ppt.html` | P1 | bundle 里已有，主要是模式切换 |

### E. 搜索

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| E1 | 全库搜索：标题 + 正文，多词全匹配，标题优先，异步 | `MiaoYanCore.NoteSearch` | P0 | 纯逻辑，可移植 |
| E2 | 编辑器 / 预览内查找替换 | `MPreviewView+Search` | P1 | |
| E3 | 搜索结果定位与清除 | | P1 | |
| E4 | URL / CLI 触发搜索 | | P2 | |

### F. 导出与演示

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| F1 | 导出 PDF（打印排版、分页、等图表就绪） | `Helpers/PdfExportController.swift` | P1 | 用 WKWebView 打印，分页需逐项对 |
| F2 | 导出 PNG 长图 | `Extensions/MPreviewView+Export.swift` | P1 | |
| F3 | 导出 HTML（内嵌图片与 CSS） | `Business/HtmlManager.swift` | P1 | |
| F4 | 导出 PPT PDF | 同上 | P2 | |
| F5 | 导出到下载目录 + 进度 / Toast | | P1 | |
| F6 | 深浅色导出策略 | | P1 | |

### G. 设置

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| G1 | 通用：存储位置、外观、语言（重启生效）、标题栏按钮、置顶、唤起快捷键 | `GeneralPrefsViewController` | P0 | MVP 只做存储位置与外观 |
| G2 | 编辑器：默认模式、图片上传、换行方式、预览打开位置、预览宽度 | `EditorPrefsViewController` | P1 | |
| G3 | 字体：编辑 / 预览 / 代码 / 界面 / 演示字号，推荐字体与未安装提示 | `TypographyPrefsViewController` | P0 | MVP 用默认字体栈 |
| G4 | 设置窗口布局规范（568pt、三标签、行式） | `Views/PrefsControls.swift` | P1 | |
| G5 | 设置即时生效，重启项在行内标注 | | P1 | |

### H. 窗口、菜单、快捷键

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| H1 | 主窗口：标题栏、三栏、工具按钮 | `MainWindowController` | P0 | Tauri 窗口 + 自绘标题栏 |
| H2 | 原生菜单栏（File / Edit / Format / View / Window / Help） | `Main.storyboard` | P0 | MVP 只做核心项 |
| H3 | 快捷键：⌘1–5、⌘\、⌘N/R/D/O/⌫、⇧⌘N/L、⌥⌘P/I/R、⌥⌘0/M | storyboard | P0 | MVP 只做 ⌘N/⌘3/⌘\/⌘F/⌘R/⌘⌫ |
| H4 | 全屏、最小化、置顶 | | P1 | |
| H5 | 全局唤起快捷键 | `KeyboardShortcuts` | P2 | Tauri 插件 |
| H6 | 关于窗口、开源许可 | | P1 | |
| H7 | 自动更新 | Sparkle | P1 | Tauri updater 或自建；签名迁移要单独设计 |

### I. 系统集成

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| I1 | URL Scheme：`miaoyan://` 的 find / new / goto / guide，以及 `nv://`、`nvalt://` | `AppDelegate+URLRoutes` | P2 | |
| I2 | CLI：`miao open/new/search/list/cat/update` | `scripts/miaoyan` | P2 | 可直接用 Rust 重写 |
| I3 | Finder 打开 `.md`、文档图标 | `Info.plist` | P1 | |
| I4 | 沙盒 + 安全书签 | entitlements | P1 | 上架必需 |
| I5 | 诊断日志（本地环形缓冲） | `Helpers/Diagnostics.swift` | P1 | |
| I6 | 多语言：简中 / 繁中 / 日 / 西 / 英 | `.lproj` | P1 | MVP 先中英 |
| I7 | 首次启动三篇指南 | `MiaoYanCore.GuideSeed` | P1 | |
| I8 | 错误上报与崩溃可见 | `AppDelegate.trackError` | P1 | |

### J. Markdown 方言

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| J1 | 标准 GFM | cmark-gfm | P0 | 直接链 C 库，输出可与现在逐字节一致 |
| J2 | 表格 | 同上 | P0 | |
| J3 | 任务列表 | 同上 | P0 | |
| J4 | 删除线 | 同上 | P0 | |
| J5 | 脚注 | 同上 | P1 | |
| J6 | `[[双链]]` + 反向链接 | `Business/WikilinkIndex.swift` | P1 | 索引需覆盖未打开笔记 |
| J7 | 数学 | KaTeX | P1 | |
| J8 | 三种图表 | bundle | P1 | |
| J9 | `<details>` 折叠 | | P1 | |
| J10 | 行内 HTML | | P0 | |
| J11 | PPT：`---` 分页 + Reveal 配置注释 | `skills/miaoyan` | P1 | |
| J12 | 音视频标签 | | P2 | |

### K. 非功能

| ID | 功能 | 现状落点 | 优先级 | 实现要点 |
|---|---|---|---|---|
| K1 | 启动速度与内存保持原生量级 | | P0 | Tauri + 系统 WebView 可满足 |
| K2 | 千篇级笔记库的扫描与列表 | | P1 | |
| K3 | 保存可靠性：不丢字、不空写 | | P0 | |
| K4 | 笔记保持纯 `.md`，可随时迁走 | | P0 | |
| K5 | 测试：核心逻辑单测 + 关键回归 | `MiaoYanTests` | P0 | |
| K6 | 签名 / 公证 / 分发 | `scripts/build.sh` | P1 | |
| K7 | 可访问性 | | P2 | |
| K8 | 崩溃恢复 | | P1 | |

## 3. 统计

| 级别 | 数量 | 占比 |
|---|---|---|
| P0 | 49 | 40% |
| P1 | 59 | 48% |
| P2 | 16 | 12% |
| 合计 | 124 | 100% |

P0 看起来多，但其中约 15 项是配置、常量，或随 `DownView.bundle` / cmark-gfm 复用的零成本项。真正需要独立工程的是三块：编辑器、文件安全、预览桥接。

## 4. MVP 定义

### 4.1 一句话

**MVP = 一个能在自己的文件夹里安全写作的 Markdown 编辑器**：打开库、看见列表、写、看、搜、存，不丢内容。

### 4.2 用户故事（验收即按这 7 条走）

1. 我选一个文件夹作为笔记库，里面已有的 `.md` 全部出现在列表里，层级正确。
2. 我按 ⌘N 新建一篇，用中文输入法写标题和正文，候选词和标点都正常。
3. 我按 ⌘3 看到排版后的预览，表格、任务列表、代码块、本地图片、Mermaid 图和公式都对。
4. 我按 ⌘\ 分栏，左边滚右边跟着滚，不卡顿。
5. 我按 ⌘F 搜一个正文里的词，能定位到那篇笔记。
6. 我关掉应用再打开，内容、选中的笔记、光标位置都还在。
7. 我删掉一篇笔记，它进了废纸篓，能恢复；我打开一个只读文件，它不会被写坏。

### 4.3 MVP 包含的 P0（按组）

| 组 | 条目 |
|---|---|
| 库与文件 | A1 A2 A3 A4 A5 A7 A9 A13 A17 A18 |
| 列表 | B1 B2 B3 B9 B10 |
| 编辑器 | C1 C2 C4 C5 C6 C10 C11 C14 C20 |
| 预览 | D1 D2 D3 D5 D6 D7 D8 D11 D19 D20 |
| 搜索 | E1 |
| 设置 | G1 G3 |
| 窗口菜单 | H1 H2 H3 |
| 语法 | J1 J2 J3 J4 J10 |
| 非功能 | K1 K3 K4 K5 |

### 4.4 MVP 明确不做

- PPT 演示与 PPT 导出
- PDF / PNG / HTML 导出
- 版本历史
- 双链与反向链接
- 拖拽移动、导入、单文件模式、应用内 Trash
- 图片上传、⌘ 悬停预览、TOC、预览内查找
- CLI、URL Scheme、自动更新、沙盒上架、多语言（仅中英）
- 文件夹的增删改移（MVP 只读已有结构）

### 4.5 MVP 的验收脚本

1. 准备一个库：3 篇笔记（中文长文、表格+任务、代码+本地图片），1 个二级文件夹。
2. 冷启动到列表可交互，记录时间与内存。
3. 输入 500 字中文，按键到上屏无可感延迟；输入法候选窗位置正确。
4. 预览逐项核对：表格、任务、代码高亮、图片、Mermaid、公式。
5. 分栏滚动：连续滚动 10 秒，观察是否掉帧、是否错位。
6. 强制退出应用，重开确认内容完整（模拟崩溃）。
7. 把一篇笔记改成只读，编辑后确认不写入、有提示。
8. 删除一篇，确认进废纸篓并可恢复。

## 5. 为什么这么排

1. **先保命，再好看。** A17/A18（原子写、fail-closed）排在所有视觉功能前面。这个项目 57 条事故里，最严重的一类都是“内容被覆盖/丢失”，不是“界面不好看”。
2. **能复用的不重写。** 预览 bundle 与 cmark-gfm 直接复用，所以数学、图表、代码高亮进入 P0；如果换成自己实现渲染，这三项都应该降到 P1 之后。
3. **编辑器是唯一不可替代的风险。** 它决定这个项目是“MiaoYan 的 Rust 版”还是“又一个 Web Markdown 编辑器”。M0 必须先验证它。
4. **P1 的顺序按依赖排。** 附件 → 版本历史 → 双链；导出依赖预览就绪；PPT 依赖导出；CLI 依赖 URL 路由。
5. **只做 macOS 让“对等”变成可验收的事。** 预览、PDF 打印、字体渲染都还是同一个 WebKit，差异集中在编辑器和外壳；三端并行等于用三套引擎对一份基准，验收成本会翻三倍。

## 6. 技术映射与风险

| 能力 | 现有实现 | Rust / React 方案 | 风险 |
|---|---|---|---|
| 应用外壳 | AppKit + 部分 SwiftUI | Tauri 2（macOS 用 WKWebView） | 中：标题栏、菜单、窗口行为要逐项对齐 |
| 编辑器 | NSTextView + TextKit 1 + 自定义 TextStorage | CodeMirror 6 | **高**：输入法、大文件、撤销粒度 |
| 预览 | WKWebView + `DownView.bundle` | 预览岛：同一份 bundle 挂在 React 容器里 | 中：桥接、CSS 作用域、滚动容器 |
| Markdown | swift-cmark-gfm | 直接 FFI 链 cmark-gfm C 库 | 低：同一份解析器 |
| 文件监听 | FSEvents | `notify` crate（FSEvents 后端） | 低 |
| 保存 | 原子写 + mtime 校验 | 同思路 | 低 |
| 废纸篓 | NSFileManager | `trash` crate 或直接调 NSFileManager | 低 |
| 搜索 | 自写 matcher | 移植 `NoteSearch` | 低 |
| 版本历史 | 自写目录快照 | 同思路 | 低 |
| PDF 导出 | WKWebView 打印 | WKWebView 打印 | **高**：分页、字体、图表等待 |
| PNG 导出 | WKWebView 快照 | 同思路 | 中 |
| 菜单 / 快捷键 | storyboard | Tauri 原生菜单 + 前端 keymap | 中：两套快捷键要避免冲突 |
| 全局快捷键 | KeyboardShortcuts | Tauri 插件 | 低 |
| 自动更新 | Sparkle | Tauri updater（macOS） | 中：签名与迁移路径 |
| 沙盒 / 书签 | App Sandbox | macOS entitlements + security-scoped bookmark | 中：本地媒体协议要重做 |
| CLI | bash | Rust bin | 低 |
| 多语言 | `.strings` | i18next | 低 |

### 五个必须前置验证的风险

1. **CodeMirror 6 在 1MB / 5000 行笔记上的输入延迟**，以及与中文输入法的兼容。
2. **现有 `DownView.bundle` 能否在 Tauri 的 WKWebView 里原样跑起来**：它依赖 `window.webkit.messageHandlers.*`、`miaoyan-file://`、以及与原生互调的 `imageProbe`。
3. **PDF 分页一致性**：同一篇含 Mermaid、表格、脚注的笔记，新旧两版导出的页数与断点是否一致。
4. **本地图片与媒体**：现有实现专门为 App Store 沙盒做了 `miaoyan-file://`（事故 I-43）。Tauri 的 asset 协议要验证同样的场景，包括 MIME 与 `Range`。
5. **滚动同步**：现在是按 `data-sourcepos` 行号建索引再插值，不是滚动百分比。预览岛要保证锚点索引与滚动容器在同一坐标系。

## 7. 里程碑与退出条件

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| **M0 技术验证** | Tauri 窗口 + CM6 打开 1MB 笔记 + 预览 bundle 渲染同一篇含 Mermaid、公式、本地图片的笔记 | 五个风险点各有结论；任何一项不过就换方案 |
| **M1 写作闭环** | P0 全部 | 4.5 的 8 条验收脚本全过 |
| **M2 编辑与预览补齐** | 高亮全集、查找替换、TOC、PPT、视频 | 与旧版并排打开同一篇笔记，肉眼无功能缺失 |
| **M3 库管理** | 文件夹操作、Trash、导入、版本历史、双链、附件清理 | 删除/移动/恢复三条链路不丢数据 |
| **M4 导出与系统集成** | PDF/PNG/HTML、URL、CLI、多语言、更新、沙盒 | 导出结果与旧版逐页对比 |
| **M5 对等验收** | 532 个测试的等价覆盖 + 57 条事故逐条复现 | 事故表全部通过 |

Windows 与 Android 不在当前里程碑内。需求已经留档，等 macOS 版稳定后单独立项，不占用这一版的时间。

## 8. 已定与待定

**已定**

1. 外壳：Tauri 2。
2. 编辑器：CodeMirror 6。
3. 预览：预览岛，复用 `DownView.bundle`，详见 `02-preview-architecture.md`。
4. 分发：macOS DMG + Tauri updater。
5. 平台：只做 macOS，Windows 与 Android 暂缓。
6. 基准：冻结当前 commit。

**待定**

1. **是否同时上 Mac App Store**：官网 DMG 已定；商店版是另一条沙盒与审核链路，可以后置。
2. **旧版迁移**：新 app 是否沿用 `com.tw93.miaoyan` 的 bundle id、读取旧库路径与偏好，还是作为并行应用安装。
3. **MVP 是否再收窄**：如果希望更快看到可运行版本，可以把 D6/D7（数学与图表）、C14（拖放）降到 M2。

## 附录 A：未来若要跨端

暂不做，列在这里避免以后重新讨论。

| ID | 内容 | 适用平台 |
|---|---|---|
| X1 | 响应式布局：桌面三栏、平板两栏、手机两级导航 | 全部 |
| X2 | 手机端文件夹抽屉、返回键逐级回退、底部工具栏 | Android |
| X3 | SAF 目录选择与持久授权（content URI，需要 Kotlin 插件） | Android |
| X4 | Windows 路径处理：盘符、长路径、保留名、大小写 | Windows |
| X5 | 平台文件监听与前台重扫 | 全部 |
| X6 | 平台删除语义：Trash / 回收站 / App 内 Trash | 全部 |
| X7 | 软键盘避让、安全区、`visualViewport` | Android |
| X8 | 触控交互：长按菜单、滑动返回、点击目标不小于 44pt | Android |
| X9 | 平台字体栈与内置中文字体子集 | 全部 |
| X10 | 平台打印与 PDF 导出 | 全部 |
| X11 | 更新通道：DMG / NSIS / APK | 全部 |
| X12 | 系统分享入口 | 全部 |
| X13 | 外接键盘快捷键映射 | Android |
| X14 | 窗口管理：置顶、全屏、多窗口 | 桌面 |
