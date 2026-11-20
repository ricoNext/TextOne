/** The browser stand-in's library, used when TextOne runs outside Tauri
 *  (`bun run dev`). The desktop app reads the same shapes off disk.
 *  The content exercises the preview: headings, tables, tasks, math, a fence. */

const now = Date.now();
const minutes = (n: number) => now - n * 60_000;
const hours = (n: number) => now - n * 3_600_000;
const days = (n: number) => now - n * 86_400_000;

export const seedNotes = [
  {
    id: "n1",
    title: "TextOne 设计笔记",
    path: "~/Library/TextOne/笔记/TextOne 设计笔记.md",
    folder: "~/Library/TextOne/笔记",
    modifiedAt: minutes(4),
    createdAt: days(12),
    pinned: true,
    body: `# TextOne 设计笔记

让写作回到**纸与墨**。三栏、纸色、一行行字，没有别的东西抢注意力。

## 三条约束

1. 预览与编辑器共用一套排版，行高一致。
2. 所有颜色来自 \`tokens.css\`，组件里不写十六进制。
3. 动画只用于反馈，不做装饰。

> 编辑器是笔，预览是纸。两者不该长得像两个应用。

### 待办

- [x] 三栏骨架
- [x] CodeMirror 6 接进来
- [ ] 预览岛接管 DownView
- [ ] 滚动同步按 sourcepos

| 层 | 技术 | 状态 |
|---|---|---|
| 外壳 | Tauri 2 | 进行中 |
| 编辑器 | CodeMirror 6 | 可用 |
| 预览 | DownView bundle | 待接 |

### 代码

\`\`\`ts
export function lineHeight(size: number) {
  return Math.round(size * 1.6);
}
\`\`\`

---

行内公式 $E = mc^2$ 与块级公式：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$
`,
  },
  {
    id: "n2",
    title: "预览岛接法",
    path: "~/Library/TextOne/笔记/预览岛接法.md",
    folder: "~/Library/TextOne/笔记",
    modifiedAt: hours(3),
    createdAt: days(5),
    pinned: false,
    body: `# 预览岛接法

React 只提供一块容器，\`DownView.bundle\` 的运行时独占子树。原生侧用命令式
API 驱动它：\`showNote\`、\`patchContent\`、\`scrollToLine\`。

## 六条消息通道

- \`checkbox\` — 勾选任务，写回源文件
- \`previewScroll\` — 预览滚到某一行
- \`tocTipClicked\` — 点目录跳转
- \`imageSize\` — 图片撑开后的高度
- \`imageProbe\` — 图片能否读取
- \`revealBackgroundColor\` — 跟随主题

## 为什么不直接重写

重写要追平 cmark-gfm 的边角、Mermaid 的版本、KaTeX 的宏包。
接线只要两天，重写要两个月，而且第二个月才开始暴露差异。
`,
  },
  {
    id: "n3",
    title: "滚动同步",
    path: "~/Library/TextOne/笔记/滚动同步.md",
    folder: "~/Library/TextOne/笔记",
    modifiedAt: days(1),
    createdAt: days(9),
    pinned: false,
    body: `# 滚动同步

不用百分比。百分比在两篇长度不同的文档之间会漂。

按 \`data-sourcepos\` 建一张 \`{ line, top }\` 的索引，滚动时二分找到相邻两点，
再线性插值。这是 VS Code 的算法，MiaoYan 也用它。

\`\`\`swift
func offset(forLine line: Int) -> CGFloat {
    // 二分：最后一个 top <= 目标的行
    var low = 0, high = marks.count - 1
    while low < high {
        let mid = (low + high + 1) / 2
        if marks[mid].line <= line { low = mid } else { high = mid - 1 }
    }
    return marks[low].top
}
\`\`\`

反向（预览滚 → 编辑器）用平方根阻尼，直连会抖。
`,
  },
  {
    id: "n4",
    title: "关于慢",
    path: "~/Library/TextOne/写作/关于慢.md",
    folder: "~/Library/TextOne/写作",
    modifiedAt: days(2),
    createdAt: days(30),
    pinned: false,
    body: `# 关于慢

写字这件事，快不起来。

不是手慢，是想法要长。你把一句话放在那里，过一夜再读，它自己会告诉你哪里不对。
工具能做的只有一件事：**别打断**。

> 键盘落下，字出现。就这么多。

所以启动要快，切换笔记要快，预览要跟上。除此之外的速度都是多余的。
`,
  },
  {
    id: "n5",
    title: "写作工具清单",
    path: "~/Library/TextOne/写作/写作工具清单.md",
    folder: "~/Library/TextOne/写作",
    modifiedAt: days(4),
    createdAt: days(40),
    pinned: false,
    body: `# 写作工具清单

- **MiaoYan** — 用来写长文，Markdown 存本地
- **iA Writer** — 语法高亮克制，专注模式好
- **Obsidian** — 双链，但插件太多
- **Ulysses** — 订阅制，导出麻烦

结论：本地 Markdown 文件 + 一个安静的编辑器，其余都能自己补。
`,
  },
  {
    id: "n6",
    title: "Tauri 与 WKWebView",
    path: "~/Library/TextOne/剪藏/Tauri 与 WKWebView.md",
    folder: "~/Library/TextOne/剪藏",
    modifiedAt: days(6),
    createdAt: days(6),
    pinned: false,
    body: `# Tauri 与 WKWebView

Tauri 2 在 macOS 上用 WKWebView。它和 Safari 同源，但不是 Safari：
版本跟系统走，行为跟 AppKit 的 \`WKWebView\` 走。

## 要注意的

1. 自定义 scheme 要注册 \`WKURLSchemeHandler\`，否则 \`fetch\` 直接 404。
2. 本地文件不能走 \`file://\`，跨域会拦住 \`fetch\`。
3. 视频要支持 \`Range\`，否则拖动进度条会整段重下。

第 3 条是 MiaoYan 的一起事故，查了两天。
`,
  },
  {
    id: "n7",
    title: "字体笔记",
    path: "~/Library/TextOne/剪藏/字体笔记.md",
    folder: "~/Library/TextOne/剪藏",
    modifiedAt: days(20),
    createdAt: days(20),
    pinned: false,
    body: `# 字体笔记

正文用系统字，PingFang SC 的小字号在 Retina 上比思源黑体干净。

品牌字用 Charter。它有一点衬线，不像无衬线那样硬。

字距 0.02em。中文不需要更多，再多就散了。
`,
  },
  {
    id: "n8",
    title: "无标题",
    path: "~/Library/TextOne/笔记/无标题.md",
    folder: "~/Library/TextOne/笔记",
    modifiedAt: days(45),
    createdAt: days(45),
    pinned: false,
    body: `随手记一句：先让它跑起来，再让它好看。
`,
  },
];
