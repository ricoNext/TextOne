/** The few preferences that change how the app looks. They live in
 *  localStorage, which both windows share, and every change is announced on
 *  the Tauri event bus so the main window repaints without a reload. */

export type Appearance = "system" | "light" | "dark";

export interface Settings {
  appearance: Appearance;
  /** Body size in the editor and the preview, 13–20. */
  editorSize: number;
}

export const SETTINGS_KEY = "textone.settings";
export const SETTINGS_EVENT = "textone-settings";

export const DEFAULT_SETTINGS: Settings = {
  appearance: "system",
  editorSize: 16,
};

export function readSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      appearance:
        parsed.appearance === "light" || parsed.appearance === "dark"
          ? parsed.appearance
          : "system",
      editorSize: clamp(parsed.editorSize ?? DEFAULT_SETTINGS.editorSize),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(next: Settings) {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...next, editorSize: clamp(next.editorSize) }),
  );
}

/** Applies the appearance to `<html>` and the sizes to the CSS variables the
 *  editor and preview read. Called by both windows. */
export function applySettings(settings: Settings) {
  const root = document.documentElement;
  // `system` removes the attribute so the media query in tokens.css decides.
  if (settings.appearance === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = settings.appearance;
  }
  const size = clamp(settings.editorSize);
  root.style.setProperty("--fs-editor", `${size}px`);
  root.style.setProperty("--fs-preview", `${size}px`);
}

export function isDark(settings: Settings): boolean {
  if (settings.appearance === "dark") return true;
  if (settings.appearance === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function clamp(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SETTINGS.editorSize;
  return Math.min(20, Math.max(13, Math.round(size)));
}
