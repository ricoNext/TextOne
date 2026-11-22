import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type EditorApi } from "./Editor";
import { Preview, type PreviewApi } from "./Preview";
import { Icon } from "./Icon";
import { fullTimestamp, type Lang } from "../lib/date";
import type { EditorMode } from "../types";
import "./NoteColumn.css";

export interface OpenNoteView {
  title: string;
  path: string;
  body: string;
  modified: number;
  readonly: boolean;
}

export function NoteColumn({
  note,
  mode,
  lang,
  error,
  dark,
  fontSize,
  reveal,
  onChangeBody,
  onModeChange,
  onRetrySave,
  onDismissError,
  onReloadFromDisk,
  onRename,
  onToggleTask,
  editorApiRef,
  onPasteImage,
  renameSignal,
  style,
}: {
  note: OpenNoteView | null;
  mode: EditorMode;
  lang: Lang;
  /** A failed write, shown over the text rather than swallowed. */
  error: string | null;
  dark: boolean;
  fontSize: number;
  /** A line to jump to, from a search hit. */
  reveal: { line: number; token: number } | null;
  onChangeBody: (body: string) => void;
  onModeChange: (mode: EditorMode) => void;
  onRetrySave: () => void;
  onDismissError: () => void;
  /** Set when the write failed because the file changed underneath: the only
   *  way forward is to read the disk's version. */
  onReloadFromDisk?: () => void;
  onRename: (title: string) => void;
  /** A checkbox was clicked in the preview: flip that line of the source. */
  onToggleTask: (line: number) => void;
  /** Owned by App, so the menu bar can drive the editor. */
  editorApiRef: React.MutableRefObject<EditorApi | null>;
  /** Stores a pasted image and returns the path to insert. */
  onPasteImage: (base64: string, extension: string) => Promise<string | null>;
  /** Bumped by the context menu's Rename: start editing the title. */
  renameSignal?: number;
  style?: React.CSSProperties;
}) {
  // The title is the file name, so renaming here renames the file on disk.
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Two-way scroll sync. Whichever pane the reader touched owns the scroll for
  // a moment; the other's programmatic scroll must not bounce it back.
  const previewApi = useRef<PreviewApi | null>(null);
  const owner = useRef<{ source: "editor" | "preview" | null; until: number }>({
    source: null,
    until: 0,
  });

  const fromEditor = useCallback((line: number) => {
    if (owner.current.source === "preview" && performance.now() < owner.current.until) {
      return;
    }
    owner.current = { source: "editor", until: performance.now() + 150 };
    previewApi.current?.scrollToLine(line);
  }, []);

  const fromPreview = useCallback((line: number) => {
    if (owner.current.source === "editor" && performance.now() < owner.current.until) {
      return;
    }
    owner.current = { source: "preview", until: performance.now() + 150 };
    editorApiRef.current?.scrollToLine(line);
  }, []);

  useEffect(() => setDraft(null), [note?.path]);

  useEffect(() => {
    if (renameSignal && note) setDraft(note.title);
    // Only a new signal should start an edit; the title changing under an open
    // field would fight the typist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal]);

  useEffect(() => {
    if (draft === null) return;
    input.current?.focus();
    input.current?.select();
  }, [draft]);

  const commit = () => {
    if (draft === null) return;
    const title = draft.trim();
    setDraft(null);
    if (title && title !== note?.title) onRename(title);
  };

  return (
    <section className="note-column" style={style}>
      <header className="note-header drag-region" data-tauri-drag-region>
        {draft === null ? (
          <h1
            className="note-header-title"
            title={
              note
                ? `${note.path}  ·  ${fullTimestamp(note.modified, lang)}`
                : undefined
            }
            onDoubleClick={() => note && setDraft(note.title)}
          >
            {note?.title ?? ""}
          </h1>
        ) : (
          <input
            ref={input}
            className="note-header-input"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
              }
            }}
          />
        )}

        {note?.readonly && (
          <span className="note-badge" title="这个文件不可写，编辑不会保存">
            只读
          </span>
        )}

        {note && (
          <div className="note-header-actions">
            <button
              className="glyph-button"
              data-active={mode === "split" || undefined}
              title="分栏　⌘\"
              onClick={() =>
                onModeChange(mode === "split" ? "editor" : "split")
              }
            >
              <Icon name="icon_editor_split" />
            </button>
            <button className="glyph-button" title="格式化">
              <Icon name="icon_format" />
            </button>
            <button
              className="glyph-button"
              data-active={mode === "preview" || undefined}
              title="预览　⌘3"
              onClick={() =>
                onModeChange(mode === "preview" ? "editor" : "preview")
              }
            >
              <Icon name="icon_preview" />
            </button>
            <button className="glyph-button" title="演示">
              <Icon name="icon_presentation" />
            </button>
          </div>
        )}
      </header>

      {note ? (
        <div className="note-body" data-mode={mode}>
          {(mode === "editor" || mode === "split") && (
            <div className="note-pane">
              <Editor
                key={note.path}
                value={note.body}
                onChange={onChangeBody}
                onScrollLine={mode === "split" ? fromEditor : undefined}
                apiRef={editorApiRef}
                reveal={reveal}
                onPasteImage={onPasteImage}
              />
            </div>
          )}
          {mode === "split" && <div className="note-split-divider" />}
          {(mode === "preview" || mode === "split") && (
            <div className="note-pane">
              <Preview
                source={note.body}
                directory={directoryOf(note.path)}
                hardBreaks
                dark={dark}
                fontSize={fontSize}
                onToggleTask={onToggleTask}
                onScrollLine={mode === "split" ? fromPreview : undefined}
                apiRef={previewApi}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="note-empty">
          <Icon name="home" size={40} />
          <p>选一篇笔记，或者按 ⌘N 写一篇新的</p>
        </div>
      )}

      {error && (
        <div className="note-error">
          <span className="note-error-text">{error}</span>
          {onReloadFromDisk ? (
            <button className="note-error-action" onClick={onReloadFromDisk}>
              载入磁盘版本
            </button>
          ) : (
            <button className="note-error-action" onClick={onRetrySave}>
              重试保存
            </button>
          )}
          <button
            className="note-error-dismiss"
            title="关掉提示"
            onClick={onDismissError}
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}

/** The folder a note sits in, which relative images resolve against. */
function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : path;
}
