/** Markdown 排版，跑在 webview 里的 Prettier。
 *
 *  MiaoYan 的「Format」由 Swift 版 Prettier 完成，配置是 `proseWrap:
 *  preserve`、`htmlWhitespaceSensitivity: ignore`。这里用同一套选项，让两边的
 *  排版结果尽量一致：只整理结构（列表符号、表格对齐、标题层级分隔、缩进），
 *  不改断行。
 *
 *  Prettier 及其 markdown 解析器接近 2 MB，用动态 import 拆出去：不点「排版」
 *  就不会加载，冷启动不受影响。
 */

type Formatter = {
  format: (source: string, options: Record<string, unknown>) => Promise<string>;
};

let loading: Promise<Formatter> | null = null;

async function load(): Promise<Formatter> {
  loading ??= (async () => {
    const [standalone, markdown] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/markdown"),
    ]);
    const module = markdown as unknown as { default?: unknown };
    const plugin = module.default ?? markdown;
    return {
      format: (source, options) =>
        standalone.format(source, { ...options, plugins: [plugin] }),
    };
  })();
  return loading;
}

/** Returns the formatted document. Throws with Prettier's message when the
 *  markdown does not parse, so the caller can show it instead of writing. */
export async function formatMarkdown(source: string): Promise<string> {
  const { format } = await load();
  return format(source, {
    parser: "markdown",
    proseWrap: "preserve",
    tabWidth: 2,
    useTabs: false,
    htmlWhitespaceSensitivity: "ignore",
    endOfLine: "lf",
  });
}
