import { useRef } from "react";
import { Icon } from "./Icon";
import { shortDate, type Lang } from "../lib/date";
import type { NoteMeta, SearchHit } from "../lib/vault";
import "./NoteList.css";

interface Row {
  path: string;
  title: string;
  /** The opening of the note, or the matching line when searching. */
  snippet: string;
  /** The date under the row; empty while searching. */
  detail: string;
  /** Set when the row came from a search. */
  line?: number;
}

export function NoteList({
  notes,
  results,
  query,
  selectedPath,
  lang,
  searchRef,
  onSelect,
  onOpenResult,
  onQueryChange,
  onNewNote,
  onContextMenu,
}: {
  notes: NoteMeta[];
  results: SearchHit[];
  query: string;
  selectedPath: string | null;
  lang: Lang;
  searchRef?: React.RefObject<HTMLInputElement>;
  onSelect: (path: string) => void;
  onOpenResult: (hit: SearchHit) => void;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  /** Right-click on a row: where to draw the menu, and which note it is for. */
  onContextMenu: (event: React.MouseEvent, path: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;
  const rows: Row[] = searching
    ? results.map((hit) => ({
        path: hit.path,
        title: hit.title,
        snippet: hit.snippet,
        detail: "",
        line: hit.line,
      }))
    : notes.map((note) => ({
        path: note.path,
        title: note.title,
        snippet: note.snippet,
        detail: shortDate(note.modified, lang),
      }));

  return (
    <section className="note-list">
      <header className="note-list-header drag-region" data-tauri-drag-region>
        {/* MiaoYan's list header is a search pill, not a folder title: 30pt
            tall, fully rounded, a hairline border and no glyphs inside. */}
        <input
          ref={searchRef}
          className="note-search"
          type="search"
          placeholder="搜索"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onQueryChange("");
              event.currentTarget.blur();
            } else if (event.key === "Enter" && results[0]) {
              event.preventDefault();
              onOpenResult(results[0]);
            }
          }}
        />
        <button className="note-new" title="新建笔记　⌘N" onClick={onNewNote}>
          <Icon name="newNote" size={20} />
        </button>
      </header>

      <div
        ref={listRef}
        className="note-list-scroll scroll"
        tabIndex={0}
        role="listbox"
        aria-label="笔记列表"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (rows.length === 0) return;
          const index = rows.findIndex((row) => row.path === selectedPath);
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next =
            index < 0
              ? 0
              : Math.min(rows.length - 1, Math.max(0, index + step));
          const row = rows[next];
          if (row.line === undefined) {
            onSelect(row.path);
            return;
          }
          const hit = results.find(
            (result) => result.path === row.path && result.line === row.line,
          );
          if (hit) onOpenResult(hit);
        }}
      >
        {rows.length === 0 ? (
          <div className="note-list-empty">
            <Icon name="home" size={28} />
            <p>{searching ? "没有匹配的笔记" : "这个文件夹里还没有笔记"}</p>
          </div>
        ) : (
          <ul className="note-rows">
            {rows.map((row, index) => {
              const selected = row.path === selectedPath;
              const showsDivider =
                !selected && rows[index + 1]?.path !== selectedPath;
              return (
                <li key={`${row.path}:${row.line ?? 0}`}>
                  <div
                    className="note-row"
                    role="option"
                    aria-selected={selected}
                    data-selected={selected || undefined}
                    data-divider={showsDivider || undefined}
                    data-search={searching || undefined}
                    title={row.path}
                    onContextMenu={(event) => onContextMenu(event, row.path)}
                    onClick={() => {
                      listRef.current?.focus();
                      if (row.line === undefined) {
                        onSelect(row.path);
                        return;
                      }
                      const hit = results.find(
                        (result) =>
                          result.path === row.path && result.line === row.line,
                      );
                      if (hit) onOpenResult(hit);
                    }}
                  >
                    <div className="note-row-card">
                      <span className="note-row-title">{row.title}</span>
                      {row.snippet && (
                        <span className="note-row-snippet">{row.snippet}</span>
                      )}
                      {row.detail && (
                        <span className="note-row-meta">
                          <span className="note-row-detail">{row.detail}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
