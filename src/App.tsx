import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import type { EditorApi } from "./components/Editor";
import { NoteList } from "./components/NoteList";
import { NoteColumn } from "./components/NoteColumn";
import { Splitter } from "./components/Splitter";
import {
  createNote,
  isDesktop,
  openVault,
  readNote,
  renameNote,
  saveAttachment,
  searchNotes,
  rescanVault,
  trashNote,
  writeNote,
  type NoteMeta,
  type SearchHit,
  type Vault,
} from "./lib/vault";
import type { EditorMode, SidebarRow } from "./types";
import type { Lang } from "./lib/date";
import {
  applySettings,
  readSettings,
  SETTINGS_EVENT,
  type Settings,
} from "./lib/settings";
import "./App.css";

const ALL = "all";
const SAVE_DELAY = 1500;
const SESSION_KEY = "textone.session";
const VAULT_KEY = "textone.vault";
const SORT_KEY = "textone.sort";
const LAYOUT_KEY = "textone.layout";

/** Column widths, and whether each column is showing. A closed column keeps
 *  the width it had, so reopening it comes back the same size. */
interface Layout {
  sidebar: number;
  list: number;
  sidebarOpen: boolean;
  listOpen: boolean;
}

const SIDEBAR_SNAP = 86;
const LIST_SNAP = 180;

function readLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Layout>;
      return {
        sidebar: clampWidth(parsed.sidebar, 138, 280, 170),
        list: clampWidth(parsed.list, 220, 420, 280),
        sidebarOpen: parsed.sidebarOpen !== false,
        listOpen: parsed.listOpen !== false,
      };
    }
  } catch {
    // First launch, or a store that cannot be read.
  }
  return { sidebar: 170, list: 280, sidebarOpen: true, listOpen: true };
}

function clampWidth(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

type SortBy = "modified" | "created" | "title";

function readSort(): { by: SortBy; desc: boolean } {
  try {
    const raw = window.localStorage.getItem(SORT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { by: SortBy; desc: boolean };
      if (["modified", "created", "title"].includes(parsed.by)) return parsed;
    }
  } catch {
    // Fall through to the default: newest first.
  }
  return { by: "modified", desc: true };
}

interface OpenNote {
  meta: NoteMeta;
  body: string;
  /** The modification time the buffer is based on; a write carries it back so
   *  a file changed underneath us is not overwritten. */
  mtime: number;
  readonly: boolean;
}

export default function App() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [scope, setScope] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [mode, setMode] = useState<EditorMode>("split");
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [resizing, setResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(readSort);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [lang] = useState<Lang>("zh");
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [mediaDark, setMediaDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark =
    settings.appearance === "dark" ||
    (settings.appearance === "system" && mediaDark);

  const searchRef = useRef<HTMLInputElement>(null);
  const editorApiRef = useRef<EditorApi | null>(null);
  const revealRef = useRef(0);
  const [reveal, setReveal] = useState<{ line: number; token: number } | null>(
    null,
  );

  const timer = useRef<number | null>(null);
  const draft = useRef<{ path: string; body: string } | null>(null);
  /** The modification time the buffer is based on. A ref, not state: a write
   *  that resolves while the user keeps typing must update the baseline the
   *  next write carries, or the app conflicts with itself. */
  const baseline = useRef<{ path: string; mtime: number } | null>(null);
  /** Writes run one after another; two in flight could land out of order. */
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setMediaDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // The preferences window writes and then announces; both stay in step
  // without a reload.
  useEffect(() => {
    if (!isDesktop) return;
    const subscription = listen<Settings>(SETTINGS_EVENT, (event) => {
      setSettings(event.payload);
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  // ── Saving ───────────────────────────────────────────────────────────────
  // Declared before the boot effect that opens a note.

  const flush = useCallback(() => {
    const pending = draft.current;
    if (!pending) return queue.current;
    draft.current = null;
    const base = baseline.current;

    queue.current = queue.current.then(async () => {
      const expected = base?.path === pending.path ? base.mtime : 0;
      try {
        const mtime = await writeNote(pending.path, pending.body, expected);
        baseline.current = { path: pending.path, mtime };
        setOpen((current) =>
          current && current.meta.path === pending.path
            ? { ...current, mtime }
            : current,
        );
        setVault((current) =>
          current
            ? {
                ...current,
                notes: current.notes.map((note) =>
                  note.path === pending.path
                    ? { ...note, modified: mtime }
                    : note,
                ),
              }
            : current,
        );
        setError(null);
      } catch (reason) {
        // Keep the buffer so the write can be retried, and say why it stopped.
        if (!draft.current) draft.current = pending;
        setError(String(reason));
      }
    });

    return queue.current;
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const scheduleSave = useCallback((path: string, body: string) => {
    draft.current = { path, body };
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flushRef.current();
    }, SAVE_DELAY);
  }, []);

  // A closed window still owes the disk its last keystrokes.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      void flushRef.current();
    },
    [],
  );

  // ── Search ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      searchNotes(trimmed)
        .then((hits) => {
          if (!cancelled) setResults(hits);
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  // ── Notes ────────────────────────────────────────────────────────────────

  const openNote = useCallback(async (meta: NoteMeta) => {
    await flushRef.current();
    try {
      const loaded = await readNote(meta.path);
      baseline.current = { path: meta.path, mtime: loaded.modified };
      setOpen({
        meta: { ...meta, modified: loaded.modified },
        body: loaded.body,
        mtime: loaded.modified,
        readonly: loaded.readonly,
      });
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  // ── Opening the library ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const saved = window.localStorage.getItem(VAULT_KEY) ?? undefined;
    openVault(saved)
      .then((next) => {
        if (cancelled) return;
        setVault(next);
        // Start with every folder open: a tree that opens folded reads as an
        // empty sidebar, and the expansion state is not persisted yet.
        setExpanded(new Set(next.folders.map((folder) => folder.path)));

        // Put the writer back where they left off: same note, same mode.
        const last = readSession();
        if (last?.mode) setMode(last.mode);
        const restored = last?.path
          ? next.notes.find((note) => note.path === last.path)
          : undefined;
        if (restored) {
          setScope(restored.folder === next.root ? ALL : restored.folder);
          void openNote(restored);
          return;
        }
        const first = [...next.notes].sort(
          (a, b) => b.modified - a.modified,
        )[0];
        if (first) void openNote(first);
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      cancelled = true;
    };
    // Runs once: the library is the app's floor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeBody = useCallback(
    (body: string) => {
      setOpen((current) => {
        if (!current || current.readonly) return current;
        scheduleSave(current.meta.path, body);
        return { ...current, body };
      });
    },
    [scheduleSave],
  );

  const switchVault = useCallback(async () => {
    if (!isDesktop) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择笔记库",
    });
    if (typeof picked !== "string" || !picked) return;

    await flushRef.current();
    try {
      const next = await openVault(picked);
      window.localStorage.setItem(VAULT_KEY, picked);
      window.localStorage.removeItem(SESSION_KEY);
      setVault(next);
      setExpanded(new Set(next.folders.map((folder) => folder.path)));
      setScope(ALL);
      setQuery("");
      setOpen(null);
      const first = [...next.notes].sort((a, b) => b.modified - a.modified)[0];
      if (first) void openNote(first);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [openNote]);

  const openResult = useCallback(
    async (hit: SearchHit) => {
      const meta =
        vault?.notes.find((note) => note.path === hit.path) ?? {
          path: hit.path,
          title: hit.title,
          folder: hit.folder,
          modified: hit.modified,
          created: hit.modified,
        };
      await openNote(meta);
      revealRef.current += 1;
      setReveal({ line: hit.line, token: revealRef.current });
    },
    [vault, openNote],
  );

  const pasteImage = useCallback(
    async (base64: string, extension: string): Promise<string | null> => {
      if (!open) return null;
      if (open.readonly) {
        setError("这篇笔记是只读的，图片没有保存");
        return null;
      }
      try {
        return await saveAttachment(open.meta.path, base64, extension);
      } catch (reason) {
        setError(String(reason));
        return null;
      }
    },
    [open],
  );

  const toggleTask = useCallback(
    (line: number) => {
      setOpen((current) => {
        if (!current || current.readonly) return current;
        const lines = current.body.split("\n");
        const index = line - 1;
        if (index < 0 || index >= lines.length) return current;
        const match = /^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\])/.exec(lines[index]);
        if (!match) return current;
        const done = match[2].toLowerCase() === "x";
        lines[index] = lines[index].replace(
          /\[( |x|X)\]/,
          done ? "[ ]" : "[x]",
        );
        const body = lines.join("\n");
        scheduleSave(current.meta.path, body);
        return { ...current, body };
      });
    },
    [scheduleSave],
  );

  const addNote = useCallback(async () => {
    if (!vault) return;
    const folder = scope === ALL ? vault.root : scope;
    try {
      const meta = await createNote(folder, "无标题");
      const next = await rescanVault();
      setVault(next);
      if (folder !== vault.root) {
        setExpanded((current) => new Set(current).add(folder));
      }
      await openNote(meta);
    } catch (reason) {
      setError(String(reason));
    }
  }, [vault, scope, openNote]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const rows = useMemo<SidebarRow[]>(() => {
    const root: SidebarRow = {
      id: ALL,
      title: "全部笔记",
      kind: "all",
      depth: 0,
      hasChildren: false,
      expanded: false,
    };
    if (!vault) return [root];

    const visible = vault.folders.filter((folder) => {
      let parent = parentOf(folder.path);
      while (parent && parent !== vault.root) {
        if (!expanded.has(parent)) return false;
        parent = parentOf(parent);
      }
      return true;
    });

    return [
      root,
      ...visible.map<SidebarRow>((folder) => ({
        id: folder.path,
        title: folder.name,
        kind: "project",
        depth: folder.depth,
        hasChildren: folder.hasChildren,
        expanded: expanded.has(folder.path),
      })),
    ];
  }, [vault, expanded]);

  const visibleNotes = useMemo(() => {
    if (!vault) return [];
    const notes =
      scope === ALL
        ? vault.notes
        : vault.notes.filter((note) => note.folder === scope);
    const sorted = [...notes];
    const direction = sort.desc ? -1 : 1;
    sorted.sort((a, b) => {
      if (sort.by === "title") {
        return a.title.localeCompare(b.title, "zh-Hans") * direction;
      }
      const left = sort.by === "created" ? a.created : a.modified;
      const right = sort.by === "created" ? b.created : b.modified;
      return (left - right) * direction;
    });
    return sorted;
  }, [vault, scope, sort]);

  useEffect(() => {
    window.localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  }, [sort]);

  // ── Session ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    writeSession({ path: open.meta.path, mode });
  }, [open?.meta.path, mode]);

  const openRef = useRef(open);
  openRef.current = open;

  const renameOpen = useCallback(async (path: string, title: string) => {
    await flushRef.current();
    try {
      const next = await renameNote(path, title);
      const refreshed = await rescanVault();
      setVault(refreshed);
      const meta = refreshed.notes.find((note) => note.path === next);
      if (meta) {
        baseline.current = { path: next, mtime: meta.modified };
        setOpen((current) =>
          current && current.meta.path === path
            ? { ...current, meta }
            : current,
        );
      }
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  const removeOpen = useCallback(
    async (path: string) => {
      if (!window.confirm("移到废纸篓？之后可以从废纸篓恢复。")) return;
      // Drop the unsaved buffer first: a queued write would recreate the file
      // that was just deleted.
      draft.current = null;
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      try {
        await trashNote(path);
        const refreshed = await rescanVault();
        setVault(refreshed);
        setOpen(null);
        const next = [...refreshed.notes].sort(
          (a, b) => b.modified - a.modified,
        )[0];
        if (next) void openNote(next);
        setError(null);
      } catch (reason) {
        setError(String(reason));
      }
    },
    [openNote],
  );

  // ── Menu bar ─────────────────────────────────────────────────────────────

  // The handler outlives a render: the menu listener registers once, and the
  // ref keeps it pointing at the current state.
  const onMenu = useRef<(id: string) => void>(() => {});
  onMenu.current = (id: string) => {
    switch (id) {
      case "new_note":
        void addNote();
        break;
      case "save":
        void flush();
        break;
      case "settings":
        void invoke("open_settings");
        break;
      case "open_vault":
        void switchVault();
        break;
      case "delete_note":
        if (open) void removeOpen(open.meta.path);
        break;
      case "find":
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case "undo":
        editorApiRef.current?.undo();
        break;
      case "redo":
        editorApiRef.current?.redo();
        break;
      case "format_bold":
        editorApiRef.current?.wrap("**", "**");
        break;
      case "format_italic":
        editorApiRef.current?.wrap("*", "*");
        break;
      case "format_strike":
        editorApiRef.current?.wrap("~~", "~~");
        break;
      case "format_code":
        editorApiRef.current?.wrap("`", "`");
        break;
      case "format_link":
        editorApiRef.current?.insertLink();
        break;
      case "toggle_sidebar":
        setLayout((current) => ({
          ...current,
          sidebarOpen: !current.sidebarOpen,
        }));
        break;
      case "toggle_list":
        setLayout((current) => ({ ...current, listOpen: !current.listOpen }));
        break;
      case "sort_modified":
        setSort((current) => ({ ...current, by: "modified" }));
        break;
      case "sort_created":
        setSort((current) => ({ ...current, by: "created" }));
        break;
      case "sort_title":
        setSort((current) => ({ ...current, by: "title" }));
        break;
      case "sort_desc":
        setSort((current) => ({ ...current, desc: !current.desc }));
        break;
      case "mode_editor":
        setMode("editor");
        break;
      case "mode_split":
        setMode("split");
        break;
      case "mode_preview":
        setMode("preview");
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!isDesktop) return;
    const subscription = listen<string>("textone-menu", (event) => {
      onMenu.current(event.payload);
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // In the app the menu bar owns every accelerator; the web view only sees
    // them when there is no menu (a browser during development).
    if (isDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void flushRef.current();
      } else if (key === "n") {
        event.preventDefault();
        void addNote();
      } else if (key === "3") {
        event.preventDefault();
        setMode((current) => (current === "preview" ? "editor" : "preview"));
      } else if (key === "\\") {
        event.preventDefault();
        setMode((current) => (current === "split" ? "editor" : "split"));
      } else if (key === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (key === "backspace") {
        const current = openRef.current;
        if (!current) return;
        event.preventDefault();
        void removeOpen(current.meta.path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addNote, removeOpen]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="app"
      data-resizing={resizing || undefined}
      style={{
        gridTemplateColumns: [
          layout.sidebarOpen ? `${layout.sidebar}px` : "0px",
          layout.sidebarOpen ? "1px" : "0px",
          layout.listOpen ? `${layout.list}px` : "0px",
          layout.listOpen ? "1px" : "0px",
          "1fr",
        ].join(" "),
      }}
    >
      {layout.sidebarOpen && (
        <Sidebar
        rows={rows}
        selectedId={scope}
        libraryPath={vault?.root}
        onSelect={(id) => {
          setScope(id);
          void flush();
        }}
        onToggleExpand={(id) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onNewNote={() => void addNote()}
        />
      )}

      {layout.sidebarOpen && (
        <Splitter
          value={layout.sidebar}
          min={SIDEBAR_SNAP}
          max={280}
          snap={SIDEBAR_SNAP}
          onChange={(next) =>
            setLayout((current) =>
              next <= SIDEBAR_SNAP
                ? { ...current, sidebarOpen: false }
                : { ...current, sidebar: next, sidebarOpen: true },
            )
          }
          onToggle={() =>
            setLayout((current) => ({
              ...current,
              sidebarOpen: !current.sidebarOpen,
            }))
          }
          onResizingChange={setResizing}
        />
      )}

      {layout.listOpen && (
        <NoteList
        notes={visibleNotes}
        results={results}
        query={query}
        selectedPath={open?.meta.path ?? null}
        lang={lang}
        searchRef={searchRef}
        onSelect={(path) => {
          const meta = visibleNotes.find((note) => note.path === path);
          if (meta) void openNote(meta);
        }}
        onOpenResult={(hit) => void openResult(hit)}
        onQueryChange={setQuery}
        onNewNote={() => void addNote()}
        />
      )}

      {layout.listOpen && (
        <Splitter
          value={layout.list}
          min={LIST_SNAP}
          max={420}
          snap={LIST_SNAP}
          onChange={(next) =>
            setLayout((current) =>
              next <= LIST_SNAP
                ? { ...current, listOpen: false }
                : { ...current, list: next, listOpen: true },
            )
          }
          onToggle={() =>
            setLayout((current) => ({ ...current, listOpen: !current.listOpen }))
          }
          onResizingChange={setResizing}
        />
      )}

      <NoteColumn
        note={
          open
            ? {
                title: open.meta.title,
                path: open.meta.path,
                body: open.body,
                modified: open.mtime,
                readonly: open.readonly,
              }
            : null
        }
        mode={mode}
        lang={lang}
        dark={dark}
        fontSize={settings.editorSize}
        error={error}
        reveal={reveal}
        onChangeBody={changeBody}
        onModeChange={setMode}
        onRetrySave={() => void flush()}
        onDismissError={() => setError(null)}
        onRename={(title) => {
          if (open) void renameOpen(open.meta.path, title);
        }}
        onToggleTask={toggleTask}
        editorApiRef={editorApiRef}
        onPasteImage={pasteImage}
      />
    </div>
  );
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

function readSession(): { path?: string; mode?: EditorMode } | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(value: { path: string; mode: EditorMode }) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    // A full or disabled storage is not worth failing a keystroke over.
  }
}
