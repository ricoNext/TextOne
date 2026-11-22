import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ContextMenu.css";

export interface ContextItem {
  label: string;
  action: () => void;
  /** Drawn in the warning tone: the action cannot be undone in place. */
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** A right-click menu on the paper: an HTML one, so it can follow the theme
 *  and the type size without asking AppKit for a menu per row. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextItem[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window: a right-click near the bottom edge would
  // otherwise open off-screen.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={`${item.label}:${index}`}
          className="context-item"
          role="menuitem"
          data-danger={item.danger || undefined}
          data-separator={item.separatorBefore || undefined}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
