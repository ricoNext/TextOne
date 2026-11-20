/** The UI's own shapes. Files are the source of truth on disk; `lib/vault.ts`
 *  holds the contract with the Rust side. */

export type EditorMode = "editor" | "split" | "preview";

/** A row the sidebar draws: the library root, or a folder on disk. */
export interface SidebarRow {
  /** "all" for the library root, otherwise the folder's path. */
  id: string;
  title: string;
  kind: "all" | "project";
  /** Nesting level; 0 is a top-level folder. */
  depth: number;
  /** Whether the row draws a disclosure chevron. */
  hasChildren: boolean;
  expanded: boolean;
}
