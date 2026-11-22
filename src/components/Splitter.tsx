import { useCallback, useRef } from "react";

/** A 1px column divider with a wider hit area.
 *
 *  MiaoYan snaps a column closed when it is dragged past a threshold; the
 *  widths here clamp instead, and the snap lands with the layout work in M2. */
export function Splitter({
  value,
  min,
  max,
  snap,
  onChange,
  onToggle,
  onResizingChange,
  style,
}: {
  value: number;
  min: number;
  max: number;
  /** Dragging below this closes the column instead of shrinking it. */
  snap?: number;
  onChange: (next: number) => void;
  /** A double click closes or opens the column, as in Xcode's editors. */
  onToggle?: () => void;
  onResizingChange?: (resizing: boolean) => void;
  style?: React.CSSProperties;
}) {
  const start = useRef({ x: 0, value: 0 });
  const change = useRef(onChange);
  const resizing = useRef(onResizingChange);
  change.current = onChange;
  resizing.current = onResizingChange;

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start.current = { x: event.clientX, value };
    resizing.current?.(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, [value]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!(event.target as HTMLElement).hasPointerCapture(event.pointerId)) {
      return;
    }
    const delta = event.clientX - start.current.x;
    const floor = snap === undefined ? min : Math.min(min, snap);
    change.current(
      Math.round(Math.min(max, Math.max(floor, start.current.value + delta))),
    );
  }, [min, max, snap]);

  const end = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    resizing.current?.(false);
  }, []);

  return (
    <div
      className="splitter"
      style={style}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onToggle}
    />
  );
}
