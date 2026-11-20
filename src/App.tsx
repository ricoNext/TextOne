import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { NoteColumn } from "./components/NoteColumn";
import { Splitter } from "./components/Splitter";
import {
  createNote,
  openVault,
  readNote,
  renameNote,
  rescanVault,
  trashNote,
  writeNote,
  type NoteMeta,
  type Vault,
} from "./lib/vault";
import type { EditorMode, SidebarRow } from "./types";
import type { Lang } from "./lib/date";
import "./App.css";

const ALL = "all";
const SAVE_DELAY = 1500;
const SESSION_KEY = "textone.session";

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
  const [sidebarWidth, setSidebarWidth] = useState(170);
  const [listWidth, setListWidth] = useState(280);
  const [resizing, setResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang] = useState<Lang>("zh");

  const timer = useRef<number | null>(null);
  const draft = useRef<{ path: string; body: string } | null>(null);
  /** The modification time the buffer is based on. A ref, not state: a write
   *  that resolves while the user keeps typing must update the baseline the
   *  next write carries, or the app conflicts with itself. */
  const baseline = useRef<{ path: string; mtime: number } | null>(null);
  /** Writes run one after another; two in flight could land out of order. */
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const theme = new URLSearchParams(window.location.search).get("theme");
    if (theme === "dark" || theme === "light") {
      document.documentElement.dataset.theme = theme;
    }
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
    openVault()
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
    return [...notes].sort((a, b) => b.modified - a.modified);
  }, [vault, scope]);

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

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
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
        gridTemplateColumns: `${sidebarWidth}px 1px ${listWidth}px 1px 1fr`,
      }}
    >
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

      <Splitter
        value={sidebarWidth}
        min={138}
        max={280}
        onChange={setSidebarWidth}
        onResizingChange={setResizing}
      />

      <NoteList
        notes={visibleNotes}
        selectedPath={open?.meta.path ?? null}
        lang={lang}
        onSelect={(path) => {
          const meta = visibleNotes.find((note) => note.path === path);
          if (meta) void openNote(meta);
        }}
        onNewNote={() => void addNote()}
      />

      <Splitter
        value={listWidth}
        min={220}
        max={420}
        onChange={setListWidth}
        onResizingChange={setResizing}
      />

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
        error={error}
        onChangeBody={changeBody}
        onModeChange={setMode}
        onRetrySave={() => void flush()}
        onDismissError={() => setError(null)}
        onRename={(title) => {
          if (open) void renameOpen(open.meta.path, title);
        }}
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
