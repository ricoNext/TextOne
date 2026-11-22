/** The file layer's contract with the Rust side, plus an in-memory stand-in so
 *  `bun run dev` works in a browser with no Tauri behind it. */

import { invoke } from "@tauri-apps/api/core";
import { seedNotes } from "../data/seed";

export interface FolderRow {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
}

export interface NoteMeta {
  path: string;
  title: string;
  folder: string;
  /** Epoch milliseconds, from the file's modification date. */
  modified: number;
  created: number;
  /** The note's opening, stripped of markup, for the list. */
  snippet: string;
}

export interface Vault {
  root: string;
  folders: FolderRow[];
  notes: NoteMeta[];
}

export interface NoteBody {
  body: string;
  modified: number;
  readonly: boolean;
}

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openVault(root?: string): Promise<Vault> {
  if (!isDesktop) return browserVault();
  return invoke<Vault>("vault_open", { root: root ?? null });
}

export async function rescanVault(): Promise<Vault> {
  if (!isDesktop) return browserVault();
  return invoke<Vault>("vault_rescan");
}

export async function readNote(path: string): Promise<NoteBody> {
  if (!isDesktop) {
    const note = memory.get(path);
    if (!note) throw new Error("这篇笔记不在内存库里");
    return { body: note.body, modified: note.modified, readonly: false };
  }
  return invoke<NoteBody>("note_read", { path });
}

export async function writeNote(
  path: string,
  body: string,
  expectedModified: number,
): Promise<number> {
  if (!isDesktop) {
    const note = memory.get(path);
    if (!note) throw new Error("这篇笔记不在内存库里");
    note.body = body;
    note.modified = Date.now();
    return note.modified;
  }
  return invoke<number>("note_write", { path, body, expectedModified });
}

/** Renaming a note renames its file: the title is the file name. Returns the
 *  new path, which may carry a " 2" suffix when the name was taken. */
export async function renameNote(
  path: string,
  title: string,
): Promise<string> {
  if (!isDesktop) {
    const note = memory.get(path);
    if (!note) throw new Error("这篇笔记不在内存库里");
    const next = `${note.folder}/${title.replace(/\//g, ":")}.md`;
    memory.delete(path);
    note.path = next;
    note.title = title;
    memory.set(next, note);
    return next;
  }
  return invoke<string>("note_rename", { path, title });
}

/** Moves a note to the macOS Trash, where Finder can put it back. */
export async function trashNote(path: string): Promise<void> {
  if (!isDesktop) {
    memory.delete(path);
    return;
  }
  return invoke<void>("note_trash", { path });
}

export interface SearchHit {
  path: string;
  title: string;
  folder: string;
  modified: number;
  snippet: string;
  line: number;
}

/** Full-text search: the title first, then the first matching line. */
export async function searchNotes(query: string): Promise<SearchHit[]> {
  if (!isDesktop) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [...memory.values()]
      .filter((note) => note.title.toLowerCase().includes(needle))
      .map((note) => ({
        path: note.path,
        title: note.title,
        folder: note.folder,
        modified: note.modified,
        snippet: "",
        line: 1,
      }));
  }
  return invoke<SearchHit[]>("search_notes", { query, limit: 50 });
}

/** Writes a pasted image next to the note and returns the path to put in the
 *  markdown. In the browser there is no disk, so the data URL is returned and
 *  the preview still shows the picture. */
export async function saveAttachment(
  notePath: string,
  base64: string,
  extension: string,
): Promise<string> {
  if (!isDesktop) {
    const mime = extension === "jpg" ? "jpeg" : extension;
    return `data:image/${mime};base64,${base64}`;
  }
  return invoke<string>("save_attachment", {
    notePath,
    data: base64,
    extension,
  });
}

export async function createNote(
  folder: string,
  title: string,
): Promise<NoteMeta> {
  if (!isDesktop) {
    const meta: NoteMeta = {
      path: `${folder}/无标题 ${memory.size}.md`,
      title: title || "无标题",
      folder,
      modified: Date.now(),
      created: Date.now(),
      snippet: "",
    };
    memory.set(meta.path, { ...meta, body: "" });
    return meta;
  }
  return invoke<NoteMeta>("note_create", { folder, title });
}

// ── Browser stand-in ────────────────────────────────────────────────────────

const memory = new Map<string, NoteMeta & { body: string }>(
  seedNotes.map((note) => [
    note.path,
    {
      path: note.path,
      title: note.title,
      folder: note.folder,
      modified: note.modifiedAt,
      created: note.createdAt,
      snippet: note.body
        .split("\n")
        .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
        .find((line) => line.length > 0) ?? "",
      body: note.body,
    },
  ]),
);

function browserVault(): Vault {
  const notes = [...memory.values()];
  const folders = new Map<string, FolderRow>();
  for (const note of notes) {
    const name = note.folder.replace(/^~\/Library\/TextOne\//, "");
    if (!folders.has(note.folder)) {
      folders.set(note.folder, {
        path: note.folder,
        name,
        depth: 0,
        hasChildren: false,
      });
    }
  }
  return {
    root: "~/Library/TextOne",
    folders: [...folders.values()],
    notes: notes.map(({ body: _body, ...meta }) => meta),
  };
}
