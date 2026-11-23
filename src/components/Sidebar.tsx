import { useEffect, useRef } from "react";
import type { SidebarRow } from "../types";
import { Icon } from "./Icon";
import "./Sidebar.css";

export type FolderEdit =
  | { mode: "rename"; path: string; draft: string }
  | { mode: "create"; parent: string; depth: number; draft: string };

export function Sidebar({
  rows,
  selectedId,
  libraryPath,
  edit,
  onSelect,
  onToggleExpand,
  onNewFolder,
  onContextMenu,
  onEditChange,
  onEditCommit,
  onEditCancel,
  style,
}: {
  rows: SidebarRow[];
  selectedId: string;
  /** Shown as the tooltip of the library root and of the brand row. */
  libraryPath?: string;
  edit: FolderEdit | null;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  /** MiaoYan puts「新建文件夹」here;「新建笔记」lives on the notes list. */
  onNewFolder: () => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onEditChange: (draft: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  style?: React.CSSProperties;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!edit) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [edit?.mode, edit && "path" in edit ? edit.path : edit?.parent]);

  const drawn = buildRows(rows, edit);

  return (
    <aside className="sidebar" style={style}>
      <header className="sidebar-header drag-region" data-tauri-drag-region>
        <div className="sidebar-actions">
          <button
            className="glyph-button"
            title="新建文件夹"
            onClick={onNewFolder}
          >
            <Icon name="addProject" />
          </button>
        </div>
      </header>

      <div className="sidebar-scroll scroll">
        <div className="sidebar-brand" title={libraryPath}>
          <Icon name="home" size={24} />
          <span className="sidebar-wordmark">TextOne</span>
        </div>

        <div className="sidebar-gap" />

        <ul className="sidebar-rows" role="tree">
          {drawn.map((row) => {
            const selected = row.id === selectedId;
            const renaming =
              edit?.mode === "rename" && edit.path === row.id;
            const creating = row.id === CREATE_ID;
            const editing = renaming || creating;
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
                  title={row.kind === "root" ? libraryPath : row.id}
                  onClick={() => {
                    if (editing || row.id === CREATE_ID) return;
                    onSelect(row.id);
                  }}
                  onContextMenu={(event) => {
                    if (row.id === CREATE_ID) return;
                    event.preventDefault();
                    onContextMenu(event, row.id);
                  }}
                >
                  <Icon name="project" size={20} />
                  {editing ? (
                    <input
                      ref={inputRef}
                      className="sidebar-row-input"
                      value={edit?.draft ?? ""}
                      spellCheck={false}
                      onChange={(event) => onEditChange(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onEditCommit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          onEditCancel();
                        }
                      }}
                      onBlur={() => onEditCommit()}
                    />
                  ) : (
                    <span className="sidebar-row-title">{row.title}</span>
                  )}
                  {row.hasChildren && !editing && (
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

const CREATE_ID = "__create__";

function buildRows(
  rows: SidebarRow[],
  edit: FolderEdit | null,
): SidebarRow[] {
  if (!edit || edit.mode !== "create") return rows;

  const draftRow: SidebarRow = {
    id: CREATE_ID,
    title: edit.draft,
    kind: "project",
    depth: edit.depth,
    hasChildren: false,
    expanded: false,
  };

  if (edit.depth === 1) {
    // A top-level folder sits directly under the root node.
    const index = rows.findIndex((row) => row.kind === "root");
    if (index < 0) return [draftRow, ...rows];
    return [
      ...rows.slice(0, index + 1),
      draftRow,
      ...rows.slice(index + 1),
    ];
  }

  const parentIndex = rows.findIndex((row) => row.id === edit.parent);
  if (parentIndex < 0) return [...rows, draftRow];
  return [
    ...rows.slice(0, parentIndex + 1),
    draftRow,
    ...rows.slice(parentIndex + 1),
  ];
}
