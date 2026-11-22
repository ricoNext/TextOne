//! The commands the web view calls. Every path is checked against the open
//! library first: a command may only touch files inside it.

use std::path::PathBuf;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::{Manager, State};

use crate::storage::{self, NoteBody, NoteMeta, Vault};

#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
}

impl VaultState {
    fn root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .ok_or_else(|| "还没有打开笔记库".to_string())
    }

    fn check(&self, path: &str) -> Result<PathBuf, String> {
        let root = self.root()?;
        let candidate = PathBuf::from(path);
        if !storage::within(&root, &candidate) {
            return Err("这个路径不在笔记库里".into());
        }
        Ok(candidate)
    }
}

/// Opens a library and returns its tree. With no `root`, the last one this
/// session used, or the default `~/Documents/TextOne`.
#[tauri::command]
pub fn vault_open(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    root: Option<String>,
) -> Result<Vault, String> {
    let path = match root {
        Some(root) if !root.trim().is_empty() => PathBuf::from(root),
        _ => state
            .root()
            .unwrap_or_else(|_| storage::default_root()),
    };

    storage::ensure_root(&path)?;
    // The preview reads images off the disk; a library the user just picked
    // must be readable, not only the default one the config named.
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    if let Ok(mut guard) = state.root.lock() {
        *guard = Some(path.clone());
    }
    storage::scan(&path)
}

#[tauri::command]
pub fn vault_rescan(state: State<'_, VaultState>) -> Result<Vault, String> {
    storage::scan(&state.root()?)
}

#[tauri::command]
pub fn vault_path(state: State<'_, VaultState>) -> Result<String, String> {
    Ok(state.root()?.display().to_string())
}

/// A pasted or dropped image lands in the note's own `i/` folder, and the
/// markdown gets a path relative to the note, which the preview resolves.
#[tauri::command]
pub fn save_attachment(
    state: State<'_, VaultState>,
    note_path: String,
    data: String,
    extension: String,
) -> Result<String, String> {
    let note = state.check(&note_path)?;
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "图片数据不完整，没能保存".to_string())?;
    storage::save_attachment(&note, &bytes, &extension)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, VaultState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::storage::SearchHit>, String> {
    storage::search(&state.root()?, &query, limit.unwrap_or(50))
}

#[tauri::command]
pub fn note_read(state: State<'_, VaultState>, path: String) -> Result<NoteBody, String> {
    storage::read(&state.check(&path)?)
}

#[tauri::command]
pub fn note_write(
    state: State<'_, VaultState>,
    path: String,
    body: String,
    expected_modified: i64,
) -> Result<i64, String> {
    storage::write(&state.check(&path)?, &body, expected_modified)
}

#[tauri::command]
pub fn note_rename(
    state: State<'_, VaultState>,
    path: String,
    title: String,
) -> Result<String, String> {
    let renamed = storage::rename(&state.check(&path)?, &title)?;
    Ok(renamed.display().to_string())
}

#[tauri::command]
pub fn note_trash(state: State<'_, VaultState>, path: String) -> Result<(), String> {
    storage::trash(&state.check(&path)?)
}

#[tauri::command]
pub fn note_create(
    state: State<'_, VaultState>,
    folder: String,
    title: String,
) -> Result<NoteMeta, String> {
    let folder = state.check(&folder)?;
    storage::create(&folder, &title)
}

/// Markdown to HTML for the preview. The note's own folder comes along so
/// relative images can be pointed at the asset protocol.
/// The opening of a note, for the list row. Recomputed after a save so the
/// row does not keep showing the paragraph the writer has just replaced.
#[tauri::command]
pub fn note_snippet(state: State<'_, VaultState>, path: String) -> Result<String, String> {
    Ok(storage::snippet_of(&state.check(&path)?))
}

#[tauri::command]
pub fn note_duplicate(
    state: State<'_, VaultState>,
    path: String,
) -> Result<NoteMeta, String> {
    storage::duplicate(&state.check(&path)?)
}

#[tauri::command]
pub fn reveal_note(state: State<'_, VaultState>, path: String) -> Result<(), String> {
    storage::reveal(&state.check(&path)?)
}

#[tauri::command]
pub fn render_markdown(markdown: String, hard_breaks: bool) -> String {
    crate::markdown::render(&markdown, hard_breaks)
}

/// The preferences window. One instance: a second `Cmd-,` focuses the first.
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("设置")
        .inner_size(460.0, 396.0)
        .min_inner_size(420.0, 360.0)
        .resizable(true)
        // A normal title bar: the row of controls needs the space more than
        // the window needs the extra 28 points.
        .center()
        .build()
        .map_err(|error| format!("无法打开设置窗口：{error}"))?;
    Ok(())
}
