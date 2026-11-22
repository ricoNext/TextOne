//! TextOne's desktop shell.
//!
//! The window is a plain Tauri window: the three columns, the editor and the
//! preview are web content. The native side owns the file layer (`storage`):
//! scanning the library, reading a note, and the atomic, conflict-checked
//! write. The preview island's host arrives in a later milestone.

mod commands;
mod markdown;
mod menu;
mod storage;

use commands::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::default())
        .setup(|app| {
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::emit(app, event.id().0.as_str());
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::vault_rescan,
            commands::vault_path,
            commands::note_read,
            commands::note_write,
            commands::note_create,
            commands::note_rename,
            commands::note_trash,
            commands::note_duplicate,
            commands::reveal_note,
            commands::render_markdown,
            commands::search_notes,
            commands::save_attachment,
            commands::open_settings,
        ])
        .run(tauri::generate_context!())
        .expect("TextOne could not start");
}
