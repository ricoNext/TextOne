import { useCallback, useRef } from "react";

/** A 1px column divider with a wider hit area.
 *
 *  MiaoYan snaps a column closed when it is dragged past a threshold; the
 *  widths here clamp instead, and the snap lands with the layout work in M2. */
export function Splitter({
  value,
  min,
  max,
  onChange,
  onResizingChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  onResizingChange?: (resizing: boolean) => void;
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
    change.current(
      Math.round(Math.min(max, Math.max(min, start.current.value + delta))),
    );
  }, [min, max]);

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
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
