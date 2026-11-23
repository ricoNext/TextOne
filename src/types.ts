/** The UI's own shapes. Files are the source of truth on disk; `lib/vault.ts`
 *  holds the contract with the Rust side. */

export type EditorMode = "editor" | "split" | "preview";

/** A row the sidebar draws: one node of the folder tree. */
export interface SidebarRow {
  /** The folder's path; the library root's own path for the tree's root. */
  id: string;
  title: string;
  /** "root" is the library folder itself, the tree's only root. */
  kind: "root" | "project";
  /** Nesting level; 0 is the root node, 1 a top-level folder. */
  depth: number;
  /** Whether the row draws a disclosure chevron. */
  hasChildren: boolean;
  expanded: boolean;
}
