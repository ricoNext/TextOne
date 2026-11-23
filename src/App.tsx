import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, type FolderEdit } from "./components/Sidebar";
import type { EditorApi } from "./components/Editor";
import { NoteList } from "./components/NoteList";
import { NoteColumn } from "./components/NoteColumn";
import { Splitter } from "./components/Splitter";
import { ContextMenu, type ContextItem } from "./components/ContextMenu";
import { FolderMovePicker } from "./components/FolderMovePicker";
import { Presentation } from "./components/Presentation";
import { formatMarkdown } from "./lib/prettier";
import { directoryOf } from "./lib/path";
import {
  createFolder,
  createNote,
  duplicateNote,
  isDesktop,
  moveFolder,
  noteSnippet,
  openVault,
  readNote,
  remapPath,
  renameFolder,
  renameNote,
  revealNote,
  saveAttachment,
  searchNotes,
  rescanVault,
  trashFolder,
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
  writeSettings,
  type Settings,
} from "./lib/settings";
import "./App.css";

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
  /** The folder whose notes the list shows. The library root is one of them:
   *  it is the sidebar tree's root node. Empty until the library is known. */
  const [scope, setScope] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [mode, setMode] = useState<EditorMode>("split");
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [resizing, setResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(readSort);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [folderEdit, setFolderEdit] = useState<FolderEdit | null>(null);
  const [movePicker, setMovePicker] = useState<string | null>(null);
  const folderEditLock = useRef(false);
  const folderEditRef = useRef<FolderEdit | null>(null);
  folderEditRef.current = folderEdit;
  const skipFolderBlur = useRef(false);
  const [renameSignal, setRenameSignal] = useState(0);
  /** 排版跑在 Prettier 上，是一次异步整篇重写。 */
  const [formatting, setFormatting] = useState(false);
  /** 非空时整个窗口被幻灯片接管。 */
  const [deck, setDeck] = useState<{
    source: string;
    directory: string;
  } | null>(null);
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
  // The zoom commands read the current size outside a state updater, so the
  // store and the event bus see exactly one change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const resizeBody = useCallback((next: number) => {
    const current = settingsRef.current;
    const size = Math.min(20, Math.max(13, Math.round(next)));
    if (size === current.editorSize) return;
    const updated: Settings = { ...current, editorSize: size };
    settingsRef.current = updated;
    setSettings(updated);
    writeSettings(updated);
    applySettings(updated);
    if (isDesktop) void emit(SETTINGS_EVENT, updated);
  }, []);
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
        // The row's opening is the first paragraph of the file on disk; after
        // a save it is a different paragraph.
        const snippet = await noteSnippet(pending.path).catch(() => null);
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
                    ? {
                        ...note,
                        modified: mtime,
                        snippet: snippet ?? note.snippet,
                      }
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
    // A search jump belongs to the note it was made in; carrying it into the
    // next note would scroll to an unrelated line.
    setReveal(null);
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
        // Start with the whole tree open: a tree that opens folded reads as an
        // empty sidebar, and the expansion state is not persisted yet.
        setExpanded(
          new Set([next.root, ...next.folders.map((folder) => folder.path)]),
        );

        // Put the writer back where they left off: same note, same mode.
        const last = readSession();
        if (last?.mode) setMode(last.mode);
        const restored = last?.path
          ? next.notes.find((note) => note.path === last.path)
          : undefined;
        if (restored) {
          setScope(restored.folder);
          void openNote(restored);
          return;
        }
        const first = [...next.notes].sort(
          (a, b) => b.modified - a.modified,
        )[0];
        setScope(first ? first.folder : next.root);
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
      setExpanded(
        new Set([next.root, ...next.folders.map((folder) => folder.path)]),
      );
      setQuery("");
      setOpen(null);
      const first = [...next.notes].sort((a, b) => b.modified - a.modified)[0];
      setScope(first ? first.folder : next.root);
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
          snippet: "",
        };
      await openNote(meta);
      // The hit may live in another folder: follow it, or the list would keep
      // showing the folder the search started from.
      setScope(meta.folder);
      revealRef.current += 1;
      setReveal({ line: hit.line, token: revealRef.current });
    },
    [vault, openNote],
  );

  const openByPath = useCallback(
    async (path: string) => {
      if (openRef.current?.meta.path === path) return true;
      const meta = vault?.notes.find((note) => note.path === path);
      if (!meta) return false;
      await openNote(meta);
      setScope(meta.folder);
      return true;
    },
    [vault, openNote],
  );

  /** The disk won: drop the buffer and show what the file now holds. */
  const reloadOpen = useCallback(async () => {
    const current = openRef.current;
    if (!current) return;
    draft.current = null;
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      const loaded = await readNote(current.meta.path);
      baseline.current = { path: current.meta.path, mtime: loaded.modified };
      setOpen({
        meta: { ...current.meta, modified: loaded.modified },
        body: loaded.body,
        mtime: loaded.modified,
        readonly: loaded.readonly,
      });
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

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
    // The root node is always there, so it doubles as the fallback: a new note
    // lands where the list is looking.
    const folder = scope || vault.root;
    try {
      const meta = await createNote(folder, "无标题");
      const next = await rescanVault();
      setVault(next);
      setScope(folder);
      if (folder !== vault.root) {
        setExpanded((current) => new Set(current).add(folder));
      }
      await openNote(meta);
    } catch (reason) {
      setError(String(reason));
    }
  }, [vault, scope, openNote]);

  // ── Derived ──────────────────────────────────────────────────────────────

  // A selection can go stale: the folder it points at was trashed or moved.
  useEffect(() => {
    if (!vault) return;
    const alive =
      scope === vault.root ||
      (!!scope && vault.folders.some((folder) => folder.path === scope));
    if (!alive) setScope(vault.root);
  }, [vault, scope]);

  const rows = useMemo<SidebarRow[]>(() => {
    if (!vault) return [];

    // One tree, one root: the library folder itself. It is the only row that
    // names the collection, and clicking it lists the notes kept in it.
    const collapsed = !expanded.has(vault.root);
    const root: SidebarRow = {
      id: vault.root,
      title: nameOf(vault.root),
      kind: "root",
      depth: 0,
      hasChildren: vault.folders.length > 0,
      expanded: !collapsed,
    };
    if (collapsed) return [root];

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
        // One level in from the root node.
        depth: folder.depth + 1,
        hasChildren: folder.hasChildren,
        expanded: expanded.has(folder.path),
      })),
    ];
  }, [vault, expanded]);

  const visibleNotes = useMemo(() => {
    if (!vault) return [];
    const notes = scope
      ? vault.notes.filter((note) => note.folder === scope)
      : [];
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
        // Deleting a note from the context menu must not close the note the
        // writer is in, unless that is the one that went.
        if (openRef.current?.meta.path !== path) {
          setError(null);
          return;
        }
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

  // ── 排版与演示 ────────────────────────────────────────────────────────────

  const runFormat = useCallback(async () => {
    const current = openRef.current;
    if (!current || formatting) return;
    if (current.readonly) {
      setError("这篇笔记是只读的，排版结果不会保存");
      return;
    }
    const path = current.meta.path;
    setFormatting(true);
    try {
      const formatted = await formatMarkdown(current.body);
      // 排版要花一点时间，期间可能已经换了一篇：只写回它自己。
      const latest = openRef.current;
      if (!latest || latest.meta.path !== path || latest.body === formatted) {
        return;
      }
      const api = editorApiRef.current;
      if (api) {
        // 走编辑器：保留光标位置，整篇替换进撤销栈。
        api.replaceAll(formatted);
        return;
      }
      // 只看预览时编辑器没挂载，直接换 buffer。
      setOpen((open) => {
        if (!open || open.meta.path !== path) return open;
        scheduleSave(path, formatted);
        return { ...open, body: formatted };
      });
    } catch (reason) {
      setError(`排版失败：${String(reason)}`);
    } finally {
      setFormatting(false);
    }
  }, [formatting, scheduleSave]);

  const runPresent = useCallback(async () => {
    if (!openRef.current) return;
    // 演示读的是磁盘上的完整版本，别让最后 1.5 秒的输入留在防抖里。
    await flushRef.current();
    const current = openRef.current;
    if (!current) return;
    setDeck({
      source: current.body,
      directory: directoryOf(current.meta.path),
    });
  }, []);

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
      case "format_document":
        void runFormat();
        break;
      case "ppt":
        void runPresent();
        break;
      case "zoom_in":
        resizeBody(settingsRef.current.editorSize + 1);
        break;
      case "zoom_out":
        resizeBody(settingsRef.current.editorSize - 1);
        break;
      case "zoom_reset":
        resizeBody(16);
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

  const applyFolderRemap = useCallback((from: string, to: string) => {
    setScope((current) => remapPath(current, from, to));
    setExpanded((current) => {
      const next = new Set<string>();
      for (const path of current) next.add(remapPath(path, from, to));
      return next;
    });
    setOpen((current) => {
      if (!current) return current;
      const path = remapPath(current.meta.path, from, to);
      const folder = remapPath(current.meta.folder, from, to);
      if (path === current.meta.path && folder === current.meta.folder) {
        return current;
      }
      baseline.current = { path, mtime: current.mtime };
      return {
        ...current,
        meta: { ...current.meta, path, folder },
      };
    });
    if (draft.current) {
      draft.current = {
        ...draft.current,
        path: remapPath(draft.current.path, from, to),
      };
    }
  }, []);

  const commitFolderEdit = useCallback(async () => {
    if (skipFolderBlur.current) {
      skipFolderBlur.current = false;
      return;
    }
    const edit = folderEditRef.current;
    if (!vault || !edit || folderEditLock.current) return;
    folderEditLock.current = true;
    try {
      if (edit.mode === "create") {
        const name = edit.draft.trim();
        if (!name) {
          setFolderEdit(null);
          return;
        }
        const parent = edit.parent;
        const made = await createFolder(parent, name);
        const next = await rescanVault();
        setVault(next);
        setExpanded((current) => {
          const updated = new Set(current);
          if (parent !== vault.root) updated.add(parent);
          updated.add(made);
          return updated;
        });
        setScope(made);
        setFolderEdit(null);
      } else {
        const name = edit.draft.trim();
        if (!name) {
          setFolderEdit(null);
          return;
        }
        const leaf = edit.path.split("/").pop() ?? "";
        if (name === leaf) {
          setFolderEdit(null);
          return;
        }
        await flushRef.current();
        const renamed = await renameFolder(edit.path, name);
        applyFolderRemap(edit.path, renamed);
        setVault(await rescanVault());
        setFolderEdit(null);
      }
    } catch (reason) {
      setError(String(reason));
      setFolderEdit(null);
    } finally {
      folderEditLock.current = false;
    }
  }, [vault, applyFolderRemap]);

  const runFolderMove = useCallback(
    async (destination: string) => {
      if (!movePicker) return;
      const source = movePicker;
      setMovePicker(null);
      try {
        await flushRef.current();
        const moved = await moveFolder(source, destination);
        applyFolderRemap(source, moved);
        setVault(await rescanVault());
        setExpanded((current) => new Set(current).add(destination).add(moved));
      } catch (reason) {
        setError(String(reason));
      }
    },
    [movePicker, applyFolderRemap],
  );

  const removeFolder = useCallback(
    async (path: string) => {
      if (!window.confirm(`将文件夹「${path.split("/").pop() ?? ""}」及其全部内容移到废纸篓？`)) {
        return;
      }
      try {
        const openPath = openRef.current?.meta.path;
        if (openPath === path || openPath?.startsWith(`${path}/`)) {
          await flushRef.current();
        }
        await trashFolder(path);
        if (openPath === path || openPath?.startsWith(`${path}/`)) {
          setOpen(null);
          baseline.current = null;
          draft.current = null;
        }
        setExpanded((current) => {
          const next = new Set<string>();
          for (const item of current) {
            if (item !== path && !item.startsWith(`${path}/`)) next.add(item);
          }
          return next;
        });
        const next = await rescanVault();
        setVault(next);
        setScope((current) =>
          current === path || current.startsWith(`${path}/`)
            ? next.root
            : current,
        );
      } catch (reason) {
        setError(String(reason));
      }
    },
    [],
  );

  const folderMenuItems = useCallback((): ContextItem[] => {
    if (!vault || !folderMenu) return [];
    const id = folderMenu.id;
    const isRoot = id === vault.root;
    const parent = id;
    // The root node is level 0, so a folder made under it is level 1 and one
    // made inside a folder sits one deeper still.
    const depth = isRoot
      ? 1
      : (vault.folders.find((folder) => folder.path === id)?.depth ?? 0) + 2;
    const items: ContextItem[] = [
      {
        label: isRoot ? "新建文件夹" : "新建子文件夹",
        action: () => {
          if (!isRoot) {
            setExpanded((current) => new Set(current).add(id));
          }
          setFolderEdit({
            mode: "create",
            parent,
            depth: isRoot ? 0 : depth,
            draft: "新建文件夹",
          });
        },
      },
    ];
    if (!isRoot) {
      items.push(
        {
          label: "重命名",
          action: () => {
            setFolderEdit({
              mode: "rename",
              path: id,
              draft: id.split("/").pop() ?? "",
            });
          },
        },
        {
          label: "移动到…",
          action: () => setMovePicker(id),
        },
      );
    }
    items.push(
      {
        label: "在 Finder 中显示",
        separatorBefore: true,
        action: () => {
          void revealNote(isRoot ? vault.root : id).catch((reason) =>
            setError(String(reason)),
          );
        },
      },
      {
        label: "拷贝路径",
        action: () => {
          void navigator.clipboard.writeText(isRoot ? vault.root : id);
        },
      },
    );
    if (!isRoot) {
      items.push({
        label: "移到废纸篓",
        danger: true,
        separatorBefore: true,
        action: () => void removeFolder(id),
      });
    }
    return items;
  }, [vault, folderMenu, removeFolder]);

  const rowMenuItems = useCallback((): ContextItem[] => {
    const target = rowMenu?.path;
    if (!target) return [];
    return [
      {
        label: "重命名",
        action: () => {
          void openByPath(target).then((okay) => {
            if (okay) setRenameSignal((value) => value + 1);
          });
        },
      },
      {
        label: "制作副本",
        action: () => {
          void duplicateNote(target)
            .then(async (copy) => {
              setVault(await rescanVault());
              await openNote(copy);
            })
            .catch((reason) => setError(String(reason)));
        },
      },
      {
        label: "在 Finder 中显示",
        separatorBefore: true,
        action: () => {
          void revealNote(target).catch((reason) => setError(String(reason)));
        },
      },
      {
        label: "拷贝路径",
        action: () => {
          void navigator.clipboard.writeText(target);
        },
      },
      {
        label: "移到废纸篓",
        danger: true,
        separatorBefore: true,
        action: () => void removeOpen(target),
      },
    ];
  }, [rowMenu, openByPath, removeOpen, openNote]);

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
          style={{ gridColumn: 1 }}
          rows={rows}
          selectedId={scope}
          libraryPath={vault?.root}
          edit={folderEdit}
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
          onNewFolder={() => {
            if (!vault) return;
            setFolderEdit({
              mode: "create",
              parent: vault.root,
              depth: 1,
              draft: "新建文件夹",
            });
          }}
          onContextMenu={(event, id) => {
            setRowMenu(null);
            setFolderMenu({ x: event.clientX, y: event.clientY, id });
          }}
          onEditChange={(draft) =>
            setFolderEdit((current) =>
              current ? { ...current, draft } : current,
            )
          }
          onEditCommit={() => void commitFolderEdit()}
          onEditCancel={() => {
            skipFolderBlur.current = true;
            setFolderEdit(null);
          }}
        />
      )}

      {layout.sidebarOpen && (
        <Splitter
          style={{ gridColumn: 2 }}
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
        style={{ gridColumn: 3 }}
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
        onContextMenu={(event, path) => {
          event.preventDefault();
          setFolderMenu(null);
          setRowMenu({ x: event.clientX, y: event.clientY, path });
        }}
        onQueryChange={setQuery}
        onNewNote={() => void addNote()}
        />
      )}

      {layout.listOpen && (
        <Splitter
          style={{ gridColumn: 4 }}
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

      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenuItems()}
          onClose={() => setRowMenu(null)}
        />
      )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems()}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {movePicker && vault && (
        <FolderMovePicker
          root={vault.root}
          folders={vault.folders}
          sourcePath={movePicker}
          onPick={(destination) => void runFolderMove(destination)}
          onClose={() => setMovePicker(null)}
        />
      )}

      <NoteColumn
        style={{ gridColumn: 5 }}
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
        onReloadFromDisk={
          error?.includes("磁盘上被改过") ? () => void reloadOpen() : undefined
        }
        onRename={(title) => {
          if (open) void renameOpen(open.meta.path, title);
        }}
        onToggleTask={toggleTask}
        onFormat={() => void runFormat()}
        formatting={formatting}
        onPresent={() => void runPresent()}
        editorApiRef={editorApiRef}
        onPasteImage={pasteImage}
        renameSignal={renameSignal}
      />

      {deck && (
        <Presentation
          source={deck.source}
          directory={deck.directory}
          dark={dark}
          onClose={() => setDeck(null)}
        />
      )}
    </div>
  );
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

/** The last segment of a path: what the root row is called. */
function nameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
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
