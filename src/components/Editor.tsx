import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  indentOnInput,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import "./Editor.css";

/** MiaoYan does not resize headings in the editor: the markup is coloured, the
 *  text stays 16pt. The colours are the asset catalogue's title / link / list /
 *  html / highlight, shared with Kaku and Mole. */
const miaoYanHighlight = HighlightStyle.define([
  {
    tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: "var(--syn-heading)",
  },
  { tag: [tags.strong, tags.strikethrough], color: "var(--syn-strong)" },
  { tag: tags.emphasis, color: "var(--syn-strong)", fontStyle: "normal" },
  { tag: tags.link, color: "var(--syn-link)" },
  { tag: tags.url, color: "var(--syn-link)" },
  { tag: tags.monospace, color: "var(--syn-code)" },
  {
    tag: [tags.processingInstruction, tags.contentSeparator],
    color: "var(--syn-markup)",
  },
  { tag: tags.list, color: "var(--syn-markup)" },
  { tag: tags.quote, color: "var(--syn-markup)" },
  { tag: tags.meta, color: "var(--syn-markup)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    background: "var(--paper)",
    color: "var(--syn-body)",
    fontSize: "var(--fs-editor)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-ui)",
    lineHeight: "var(--leading-prose)",
    letterSpacing: "var(--tracking)",
    overflow: "auto",
  },
  ".cm-content": {
    // 24pt margin plus the text container's 5pt line padding.
    padding: "12px 29px 96px",
    caretColor: "var(--brand)",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--brand)",
    borderLeftWidth: "1.5px",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--selection-list)",
    },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  // Markdown's own underline on links would double up with the colour.
  ".cm-link": {
    textDecoration: "none",
  },
});

export interface EditorApi {
  /** Puts a source line at the top of the viewport. */
  scrollToLine: (line: number) => void;
}

export function Editor({
  value,
  onChange,
  onScrollLine,
  apiRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onScrollLine?: (line: number) => void;
  apiRef?: React.MutableRefObject<EditorApi | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onScrollRef = useRef(onScrollLine);
  const api = useRef(apiRef);
  onChangeRef.current = onChange;
  onScrollRef.current = onScrollLine;
  api.current = apiRef;

  useEffect(() => {
    const instance = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(miaoYanHighlight),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // MiaoYan's list continuation (Return after "- " opens the next
          // item, Backspace at its start removes the marker) comes from the
          // markdown language's own keymap, added by `markdown()`.
          placeholder("开始写字…"),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            scroll: (_event, view) => {
              // The first visible line drives the preview; the sync itself
              // lands with the preview island.
              const rect = view.scrollDOM.getBoundingClientRect();
              const pos = view.posAtCoords({
                x: rect.left + 40,
                y: rect.top + 6,
              });
              if (pos != null) {
                onScrollRef.current?.(view.state.doc.lineAt(pos).number);
              }
              return false;
            },
          }),
        ],
      }),
      parent: host.current!,
    });
    view.current = instance;
    if (api.current) {
      api.current.current = {
        scrollToLine(line: number) {
          const doc = instance.state.doc;
          const clamped = Math.min(Math.max(1, line), doc.lines);
          // CodeMirror's own scroll effect lands the line at the top edge
          // without fighting the scroll anchoring.
          instance.dispatch({
            effects: EditorView.scrollIntoView(doc.line(clamped).from, {
              y: "start",
            }),
          });
        },
      };
    }
    return () => {
      instance.destroy();
      view.current = null;
      if (api.current) api.current.current = null;
    };
    // Built once: a new note replaces the document instead of the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="editor-host" ref={host} />;
}
