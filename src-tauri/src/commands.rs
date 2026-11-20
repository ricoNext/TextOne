//! The commands the web view calls. Every path is checked against the open
//! library first: a command may only touch files inside it.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::State;

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
pub fn vault_open(state: State<'_, VaultState>, root: Option<String>) -> Result<Vault, String> {
    let path = match root {
        Some(root) if !root.trim().is_empty() => PathBuf::from(root),
        _ => state
            .root()
            .unwrap_or_else(|_| storage::default_root()),
    };

    storage::ensure_root(&path)?;
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
