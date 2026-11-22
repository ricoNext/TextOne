import { useEffect, useRef } from "react";
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import {
  HighlightStyle,
  indentUnit,
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
  /** Wraps the selection, or unwraps it when it is already wrapped. */
  wrap: (before: string, after: string) => void;
  /** Turns the selection into a link, with the URL selected for typing. */
  insertLink: () => void;
  undo: () => void;
  redo: () => void;
  /** Inserts text at the caret and leaves the caret after it. */
  insert: (text: string) => void;
  focus: () => void;
}

export function Editor({
  value,
  onChange,
  onScrollLine,
  apiRef,
  reveal,
  onPasteImage,
}: {
  value: string;
  onChange: (next: string) => void;
  onScrollLine?: (line: number) => void;
  apiRef?: React.MutableRefObject<EditorApi | null>;
  /** A line to put the caret on, from a search hit. The token makes a repeated
   *  jump to the same line fire again. */
  reveal?: { line: number; token: number } | null;
  /** Stores a pasted image and returns the markdown path, or null to drop it. */
  onPasteImage?: (base64: string, extension: string) => Promise<string | null>;
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
          // Markdown's own keymap (Enter continues a list, Backspace removes
          // the marker) is added by `markdown()` at high precedence; the task
          // list's continuation is ours, above it.
          Prec.highest(keymap.of([{ key: "Enter", run: continueTask }])),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of("  "),
          EditorState.tabSize.of(4),
          // Spelling squiggles over Chinese prose are noise; MiaoYan ships
          // with the check off.
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
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
        focus() {
          instance.focus();
        },
        undo() {
          undo(instance);
          instance.focus();
        },
        redo() {
          redo(instance);
          instance.focus();
        },
        wrap(before: string, after: string) {
          const { from, to } = instance.state.selection.main;
          const text = instance.state.sliceDoc(from, to);
          const wrapped =
            text.length >= before.length + after.length &&
            text.startsWith(before) &&
            text.endsWith(after);
          if (wrapped) {
            const inner = text.slice(before.length, text.length - after.length);
            instance.dispatch({
              changes: { from, to, insert: inner },
              selection: { anchor: from, head: from + inner.length },
            });
          } else {
            instance.dispatch({
              changes: { from, to, insert: before + text + after },
              selection: {
                anchor: from + before.length,
                head: from + before.length + text.length,
              },
            });
          }
          instance.focus();
        },
        insertLink() {
          const { from, to } = instance.state.selection.main;
          const text = instance.state.sliceDoc(from, to) || "链接文字";
          const inserted = `[${text}]()`;
          const urlStart = from + 1 + text.length + 2;
          instance.dispatch({
            changes: { from, to, insert: inserted },
            selection: { anchor: urlStart, head: urlStart },
          });
          instance.focus();
        },
        insert(text: string) {
          const { from, to } = instance.state.selection.main;
          instance.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
          instance.focus();
        },
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
    if (!instance || !reveal) return;
    const doc = instance.state.doc;
    const line = doc.line(Math.min(Math.max(1, reveal.line), doc.lines));
    instance.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    instance.focus();
  }, [reveal]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return (
    <div
      className="editor-host"
      ref={host}
      onPaste={(event) => void handleImages(event, onPasteImage, api.current)}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        void dropFiles(event.dataTransfer.files, onPasteImage, api.current);
      }}
    />
  );
}

/** Images pasted from a screenshot tool or copied from Finder. */
async function handleImages(
  event: React.ClipboardEvent,
  save: ((base64: string, extension: string) => Promise<string | null>) | undefined,
  api: React.MutableRefObject<EditorApi | null> | undefined,
) {
  if (!save) return;
  const item = Array.from(event.clipboardData.items).find((entry) =>
    entry.type.startsWith("image/"),
  );
  if (!item) return;
  // Only claim the paste once there is an image in it, so text paste is left
  // to CodeMirror.
  event.preventDefault();
  const file = item.getAsFile();
  if (!file) return;
  await insertFile(file, save, api);
}

async function dropFiles(
  files: FileList,
  save: ((base64: string, extension: string) => Promise<string | null>) | undefined,
  api: React.MutableRefObject<EditorApi | null> | undefined,
) {
  if (!save) return;
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    await insertFile(file, save, api);
  }
}

async function insertFile(
  file: File,
  save: (base64: string, extension: string) => Promise<string | null>,
  api: React.MutableRefObject<EditorApi | null> | undefined,
) {
  const extension = (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
  const base64 = await toBase64(file);
  if (!base64) return;
  const path = await save(base64, extension);
  if (path) api?.current?.insert(`![](${path})`);
}

function toBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Enter inside a task item opens the next empty box. Markdown's own
 *  continuation only carries `- `, and an empty box on Enter leaves the
 *  list, which is the "two returns" habit without needing the second. */
function continueTask(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.from);
  if (range.from !== line.to) return false;

  const match = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]\s*(.*)$/.exec(line.text);
  if (!match) return false;

  if (match[3].trim() === "") {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    });
    return true;
  }

  const insert = `\n${match[1]}[ ] `;
  view.dispatch({
    changes: { from: range.from, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
  });
  return true;
}
