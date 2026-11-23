import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isDesktop } from "../lib/vault";
import { joinPath } from "../lib/path";
import "./Presentation.css";

/** 全屏幻灯片：把笔记的 markdown 交给 bundle 自带的 Reveal.js。
 *
 *  `public/preview/ppt.html` 是 MiaoYan 的演示模板，占位符与预览模板同一套写法。
 *  这里只做三件事：填模板、请求原生全屏、把幻灯片里的相对图片换成 asset URL。
 *  分页沿用 Reveal 的约定 —— `---` 单独一行切一屏，`<!-- key: value -->`
 *  出现在开头时当作 Reveal 配置。
 */

const TEMPLATE_URL = "/preview/ppt.html";

/** Reveal 的 `revealBackgroundColor` 通道在演示页里会被调用；给它一个空实现，
 *  否则 slidechanged 时控制台每次翻页都报一次错。 */
const BRIDGE_SHIM = `<script>
  window.webkit = window.webkit || { messageHandlers: {} };
  window.webkit.messageHandlers.revealBackgroundColor = {
    postMessage: function () {}
  };
</script>`;

/** Esc 退出，捕获阶段拦下，避免 Reveal 把它当成 overview 切换。 */
const EXIT_SCRIPT = `<script>
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      parent.postMessage({ source: 'textone-deck', type: 'close' }, '*');
    }
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof Reveal === 'undefined') return;
    Reveal.on('ready', function () {
      parent.postMessage({ source: 'textone-deck', type: 'ready' }, '*');
    });
  });
</script>`;

export function Presentation({
  source,
  directory,
  dark,
  onClose,
}: {
  source: string;
  /** The note's folder, against which relative images resolve. */
  directory: string;
  dark: boolean;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The template is a static asset; fetch it once per presentation.
  useEffect(() => {
    let cancelled = false;
    fetch(TEMPLATE_URL)
      .then((response) => response.text())
      .then((text) => {
        if (!cancelled) setTemplate(text);
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Native full screen where Tauri allows it; the overlay already covers the
  // window, so a refusal is not fatal.
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (active) await getCurrentWindow().setFullscreen(true);
      } catch {
        // Leave the in-window overlay as the stage.
      }
    })();
    return () => {
      active = false;
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFullscreen(false);
        } catch {
          // Already gone.
        }
      })();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rewriteImages = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll<HTMLImageElement>(".slides img").forEach((image) => {
      const raw = image.getAttribute("src") ?? "";
      if (!raw || /^(https?:|data:|blob:|asset:|tauri:)/.test(raw)) return;
      const absolute = raw.startsWith("/") ? raw : joinPath(directory, raw);
      image.src = convertFileSrc(absolute);
    });
  };

  // Slides are assembled by Reveal after boot and per navigation, and the
  // browser's `load` fires before that. Rewrite on the ready message, and once
  // more on a timer for decks whose images arrive later.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "textone-deck") return;
      if (data.type === "close") onClose();
      if (data.type === "ready") rewriteImages();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [directory, onClose]);

  if (error) {
    return (
      <div className="presentation">
        <div className="presentation-error">
          <p>幻灯片没能加载</p>
          <pre>{error}</pre>
          <button type="button" onClick={onClose}>
            退出
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="presentation" role="dialog" aria-label="幻灯片">
      {template && (
        <iframe
          ref={frame}
          className="presentation-frame"
          title="幻灯片"
          sandbox="allow-scripts allow-same-origin allow-popups"
          srcDoc={buildDeck(template, source, dark)}
          onLoad={() => {
            rewriteImages();
            window.setTimeout(rewriteImages, 500);
            window.setTimeout(rewriteImages, 1500);
          }}
        />
      )}
      <button
        type="button"
        className="presentation-exit"
        title="退出演示　Esc"
        onClick={onClose}
      >
        Esc
      </button>
    </div>
  );
}

/** The deck template with its placeholders filled.
 *
 *  The markdown replaces the template's `<script type="text/template">` node
 *  wholesale rather than the `DOWN_RAW` word: the template indents that word,
 *  and four leading spaces would turn the first line into a code block. */
function buildDeck(template: string, markdown: string, dark: boolean): string {
  const theme = dark ? "night.css" : "white.css";
  const customCss = `
    :root {
      --deck-font: -apple-system, BlinkMacSystemFont, "PingFang SC",
        "Hiragino Sans GB", sans-serif;
    }
    .reveal { font-family: var(--deck-font); }
    .reveal .slides { text-align: left; }
    .reveal .slides img { max-height: 70vh; }
  `;
  // A note can contain `</script>`; the backslash keeps the HTML parser from
  // closing the template node early.
  const raw = stripFrontmatter(markdown).replace(/<\/script>/gi, "<\\/script>");
  const scriptNode =
    /(<script type="text\/template">)([\s\S]*?)(<\/script>)/;

  const filled = template
    .replace(
      "DOWN_THEME",
      () => `<link rel="stylesheet" href="ppt/dist/theme/${theme}" id="theme" />`,
    )
    .replaceAll("DOWN_CSS", () => customCss)
    .replaceAll("DOWN_EXPORT_TYPE", "preview")
    .replace('<link rel="stylesheet" href="themes/mermaid.css" />', "")
    .replace('<script src="js/index.js"></script>', "")
    .replace("<head>", () => `<head><base href="/preview/" />${BRIDGE_SHIM}`)
    .replace("</body>", () => `${EXIT_SCRIPT}</body>`);

  return filled.replace(
    scriptNode,
    (_match, open: string, _body: string, close: string) =>
      `${open}\n${raw}\n${close}`,
  );
}

/** A leading `---` block is metadata; Reveal would read it as a slide break. */
function stripFrontmatter(markdown: string): string {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n/.exec(markdown);
  return (match ? markdown.slice(match[0].length) : markdown).trimStart();
}
