import type { SidebarRow } from "../types";
import { Icon } from "./Icon";
import "./Sidebar.css";

export function Sidebar({
  rows,
  selectedId,
  libraryPath,
  onSelect,
  onToggleExpand,
  onNewNote,
}: {
  rows: SidebarRow[];
  selectedId: string;
  /** Shown as the tooltip of the library root and of the brand row. */
  libraryPath?: string;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onNewNote: () => void;
}) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header drag-region" data-tauri-drag-region>
        <div className="sidebar-actions">
          <button
            className="glyph-button"
            title="新建笔记　⌘N"
            onClick={onNewNote}
          >
            <Icon name="newNote" />
          </button>
        </div>
      </header>

      <div className="sidebar-scroll scroll">
        {/* The lockup: a 24pt bird 6pt from the wordmark. MiaoYan sets a Latin
            name in Charter and shifts the text 2pt below the bird's centre,
            because the bird's ink sits high. */}
        <div className="sidebar-brand" title={libraryPath}>
          <Icon name="home" size={24} />
          <span className="sidebar-wordmark">TextOne</span>
        </div>

        <div className="sidebar-gap" />

        <ul className="sidebar-rows" role="tree">
          {rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <li key={row.id}>
                <div
                  className="sidebar-row"
                  role="treeitem"
                  aria-selected={selected}
                  aria-level={row.depth + 1}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  data-selected={selected || undefined}
                  style={{ paddingLeft: 12 + row.depth * 14 }}
                  title={row.kind === "all" ? libraryPath : row.id}
                  onClick={() => onSelect(row.id)}
                >
                  <Icon
                    name={row.kind === "all" ? "allNotes" : "project"}
                    size={20}
                  />
                  <span className="sidebar-row-title">{row.title}</span>
                  {row.hasChildren && (
                    <button
                      className="sidebar-chevron"
                      data-expanded={row.expanded || undefined}
                      title={row.expanded ? "折叠" : "展开"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleExpand(row.id);
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="11" height="11">
                        <path
                          d="M6 3.5 10.5 8 6 12.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
