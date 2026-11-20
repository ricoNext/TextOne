import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../lib/vault";
import {
  buildIndex,
  lineForOffset,
  offsetForLine,
  type Mark,
} from "../lib/scrollSync";
import { MarkdownPreview } from "./MarkdownPreview";
import "./Preview.css";

/** The preview island.
 *
 *  MiaoYan's `DownView.bundle` is a self-contained page runtime: cmark-gfm
 *  hands it HTML, and its own scripts draw formulas, diagrams, code colouring,
 *  emoji and image sizing. Rewriting that would take months; hosting it takes
 *  an iframe. The bundle's six native channels (`webkit.messageHandlers`) are
 *  shimmed to `postMessage`, so the same runtime talks to React instead of to
 *  AppKit.
 *
 *  After the first load the document is never reloaded: a new note patches
 *  `#write` and calls the bundle's own `renderPage`, which is what MiaoYan
 *  does when it shows a note in place.
 */

const TEMPLATE_URL = "/preview/index.html";

const BRIDGE_SHIM = `<script>
  (function () {
    var send = function (type) {
      return {
        postMessage: function (payload) {
          parent.postMessage({ source: "textone-preview", type: type, payload: payload }, "*");
        }
      };
    };
    window.webkit = {
      messageHandlers: {
        checkbox: send("checkbox"),
        imageSize: send("imageSize"),
        imageProbe: send("imageProbe"),
        previewScroll: send("previewScroll"),
        tocTipClicked: send("tocTipClicked"),
        revealBackgroundColor: send("revealBackgroundColor")
      }
    };
  })();
</script>`;

export interface PreviewApi {
  /** Puts a source line at the top of the preview. */
  scrollToLine: (line: number) => void;
}

export function Preview({
  source,
  directory,
  hardBreaks,
  dark,
  onToggleTask,
  onScrollLine,
  apiRef,
}: {
  source: string;
  /** The note's folder, against which relative image paths resolve. */
  directory: string;
  hardBreaks: boolean;
  dark: boolean;
  /** A checkbox was clicked in the preview: the line to flip in the source. */
  onToggleTask: (line: number) => void;
  /** The first line fully visible after a user scroll. */
  onScrollLine?: (line: number) => void;
  apiRef?: React.MutableRefObject<PreviewApi | null>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const rendered = useRef<string>("");
  /** Block offsets, rebuilt whenever the document changes. */
  const marks = useRef<Mark[]>([]);
  const onScrollRef = useRef(onScrollLine);
  const api = useRef(apiRef);
  onScrollRef.current = onScrollLine;
  api.current = apiRef;

  // The template is fetched once; seven megabytes of runtime come with it.
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

  // Render the note, then either boot the island or patch it in place.
  useEffect(() => {
    if (!template || !isDesktop) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      invoke<string>("render_markdown", {
        markdown: source,
        hardBreaks,
      })
        .then((html) => {
          if (cancelled) return;
          rendered.current = html;
          setError(null);
          patch(html, dark);
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `patch` reads the refs it needs; re-running on theme is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, hardBreaks, template]);

  // A theme change is a reload, not a patch: the bundle picks its colours when
  // it boots.
  const lastDark = useRef(dark);
  useEffect(() => {
    if (lastDark.current === dark) return;
    lastDark.current = dark;
    if (loaded.current && frame.current && template) {
      frame.current.srcdoc = buildDocument(template, rendered.current, dark);
    }
  }, [dark, template]);

  const patch = (html: string, isDark: boolean) => {
    const doc = frame.current?.contentDocument;
    if (!loaded.current || !doc) {
      if (frame.current && template) {
        frame.current.srcdoc = buildDocument(template, html, isDark);
        loaded.current = true;
      }
      return;
    }
    const write = doc.getElementById("write");
    if (!write) return;
    write.innerHTML = html;
    rewriteImages(doc, directory);
    // The bundle re-runs KaTeX, highlight, diagrams and image sizing on the
    // blocks just inserted.
    const runtime = doc.defaultView as unknown as {
      MiaoYanCommon?: { renderPage?: () => void };
    };
    runtime?.MiaoYanCommon?.renderPage?.();
  };

  const rebuildIndex = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const scroller = doc.scrollingElement ?? doc.documentElement;
    const blocks = doc.querySelectorAll("#write [data-sourcepos]");
    marks.current = buildIndex(
      blocks,
      (element) => element.getBoundingClientRect().top + scroller.scrollTop,
      (element) => {
        const position = element.getAttribute("data-sourcepos") ?? "";
        return Number.parseInt(position.split("-")[0].split(":")[0], 10);
      },
    );
    if (api.current) {
      api.current.current = {
        scrollToLine(line: number) {
          const target = frame.current?.contentDocument;
          if (!target) return;
          const box = target.scrollingElement ?? target.documentElement;
          box.scrollTop = offsetForLine(marks.current, line);
        },
      };
    }
  };

  // One listener for the island's scrolls, so the editor can follow.
  useEffect(() => {
    const view = frame.current?.contentWindow;
    if (!view) return;
    let frameId = 0;
    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        const doc = frame.current?.contentDocument;
        if (!doc) return;
        const box = doc.scrollingElement ?? doc.documentElement;
        const line = lineForOffset(marks.current, box.scrollTop);
        onScrollRef.current?.(line);
      });
    };
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => view.removeEventListener("scroll", onScroll);
  }, [template]);

  // Checkbox clicks come back through the shim.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "textone-preview") return;
      if (data.type === "checkbox" && typeof data.payload === "string") {
        const match = /^line:(\d+)$/.exec(data.payload);
        if (match) onToggleTask(Number(match[1]));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onToggleTask]);

  // Outside Tauri there is no renderer to call; the browser keeps the small
  // stand-in so the three columns can still be worked on.
  if (!isDesktop) return <MarkdownPreview source={source} />;

  if (error) {
    return (
      <div className="preview-error">
        <p>预览没能加载</p>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <iframe
      ref={frame}
      className="preview-frame"
      title="预览"
      sandbox="allow-scripts allow-same-origin allow-popups"
      onLoad={() => {
        const doc = frame.current?.contentDocument;
        if (doc) rewriteImages(doc, directory);
        rebuildIndex();
        // Images and diagrams change the page height as they arrive.
        window.setTimeout(rebuildIndex, 600);
      }}
    />
  );
}

/** Note-relative images become asset URLs; the iframe cannot read the disk by
 *  itself, and `file://` is blocked inside a web view. */
function rewriteImages(doc: Document, directory: string) {
  doc.querySelectorAll<HTMLImageElement>("#write img").forEach((image) => {
    const raw = image.getAttribute("data-src") ?? image.getAttribute("src");
    if (!raw) return;
    if (/^(https?:|data:|blob:|asset:)/.test(raw)) return;
    const absolute = raw.startsWith("/")
      ? raw
      : joinPath(directory, raw);
    image.src = convertFileSrc(absolute);
    image.removeAttribute("data-src");
  });
}

function joinPath(directory: string, relative: string): string {
  const parts = directory.split("/").filter(Boolean);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return "/" + parts.join("/");
}

/** The bundle's own template, with its four placeholders filled. */
function buildDocument(template: string, html: string, dark: boolean): string {
  // The bundle brings its own layout (28pt side margins, 1.64 line height).
  // Only the size and the face are a preference.
  const customCss = `
    :root {
      --text-font: -apple-system, BlinkMacSystemFont, "PingFang SC",
        "Hiragino Sans GB", sans-serif;
    }
    #write { font-size: 16px; }
  `;

  return template
    .replaceAll("DOWN_META", `<base href="/preview/">${BRIDGE_SHIM}`)
    .replaceAll("CUSTOM_CSS", dark ? "darkmode" : "lightmode")
    .replaceAll("DOWN_CSS", () => customCss)
    .replaceAll("DOWN_HTML", () => html);
}
