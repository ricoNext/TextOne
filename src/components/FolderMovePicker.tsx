import { useEffect, useRef } from "react";
import type { FolderRow } from "../lib/vault";
import "./FolderMovePicker.css";

/** In-library destination picker for moving a folder. The source and its
 *  descendants cannot be chosen; the library root is always available. */
export function FolderMovePicker({
  root,
  folders,
  sourcePath,
  onPick,
  onClose,
}: {
  root: string;
  folders: FolderRow[];
  sourcePath: string;
  onPick: (destination: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const disabled = (path: string) =>
    path === sourcePath || path.startsWith(`${sourcePath}/`);

  return (
    <div className="folder-move-backdrop" role="presentation">
      <div
        ref={box}
        className="folder-move-picker"
        role="dialog"
        aria-label="移动到"
      >
        <header className="folder-move-header">移动到…</header>
        <ul className="folder-move-list">
          <li>
            <button
              type="button"
              className="folder-move-row"
              disabled={disabled(root)}
              onClick={() => onPick(root)}
            >
              笔记库根目录
            </button>
          </li>
          {folders.map((folder) => (
            <li key={folder.path}>
              <button
                type="button"
                className="folder-move-row"
                style={{ paddingLeft: 14 + folder.depth * 14 }}
                disabled={disabled(folder.path)}
                onClick={() => onPick(folder.path)}
              >
                {folder.name}
              </button>
            </li>
          ))}
        </ul>
        <footer className="folder-move-footer">
          <button type="button" className="folder-move-cancel" onClick={onClose}>
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}
