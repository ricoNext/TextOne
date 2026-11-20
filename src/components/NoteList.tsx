import { Icon } from "./Icon";
import { shortDate, type Lang } from "../lib/date";
import type { NoteMeta } from "../lib/vault";
import "./NoteList.css";

export function NoteList({
  notes,
  selectedPath,
  lang,
  onSelect,
  onNewNote,
}: {
  notes: NoteMeta[];
  selectedPath: string | null;
  lang: Lang;
  onSelect: (path: string) => void;
  onNewNote: () => void;
}) {
  return (
    <section className="note-list">
      <header className="note-list-header drag-region" data-tauri-drag-region>
        {/* MiaoYan's list header is a search pill, not a folder title: 30pt
            tall, fully rounded, a hairline border and no glyphs inside. The
            placeholder carries the meaning. */}
        <input
          className="note-search"
          type="search"
          placeholder="搜索"
          spellCheck={false}
        />
        <button className="note-new" title="新建笔记　⌘N" onClick={onNewNote}>
          <Icon name="newNote" size={20} />
        </button>
      </header>

      <div className="note-list-scroll scroll">
        {notes.length === 0 ? (
          <div className="note-list-empty">
            <Icon name="home" size={28} />
            <p>这个文件夹里还没有笔记</p>
          </div>
        ) : (
          <ul className="note-rows">
            {notes.map((note, index) => {
              const selected = note.path === selectedPath;
              // The line parts a row from the next one unless either of them
              // carries the selection plate (MiaoYan's isNextRowSelected).
              const showsDivider =
                !selected && notes[index + 1]?.path !== selectedPath;
              return (
                <li key={note.path}>
                  <div
                    className="note-row"
                    role="option"
                    aria-selected={selected}
                    data-selected={selected || undefined}
                    data-divider={showsDivider || undefined}
                    title={note.path}
                    onClick={() => onSelect(note.path)}
                  >
                    <div className="note-row-card">
                      <span className="note-row-title">{note.title}</span>
                      <span className="note-row-meta">
                        <span className="note-row-date">
                          {shortDate(note.modified, lang)}
                        </span>
                      </span>
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
