import { useEffect, useRef, useState } from "react";
import { Editor } from "./Editor";
import { MarkdownPreview } from "./MarkdownPreview";
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
  onChangeBody,
  onModeChange,
  onRetrySave,
  onDismissError,
  onRename,
}: {
  note: OpenNoteView | null;
  mode: EditorMode;
  lang: Lang;
  /** A failed write, shown over the text rather than swallowed. */
  error: string | null;
  onChangeBody: (body: string) => void;
  onModeChange: (mode: EditorMode) => void;
  onRetrySave: () => void;
  onDismissError: () => void;
  onRename: (title: string) => void;
}) {
  // The title is the file name, so renaming here renames the file on disk.
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(null), [note?.path]);

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
    <section className="note-column">
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
              />
            </div>
          )}
          {mode === "split" && <div className="note-split-divider" />}
          {(mode === "preview" || mode === "split") && (
            <div className="note-pane">
              <MarkdownPreview source={note.body} />
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
          <button className="note-error-action" onClick={onRetrySave}>
            重试保存
          </button>
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
