//! The macOS menu bar.
//!
//! Every item that changes a note emits an event instead of acting: the web
//! side owns the document, so the menu is a keyboard surface over the same
//! commands the buttons call. Cut/copy/paste/select-all stay predefined, since
//! those act on whatever the responder chain has focused — the web view
//! included.
//!
//! Undo and Redo are not predefined for the same reason they are listed here:
//! the editor keeps its own history (CodeMirror), and a predefined Undo would
//! ask the web view's undo manager, which knows nothing about it.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub const MENU_EVENT: &str = "textone-menu";

/// Menu items whose only job is to tell the web side what was chosen.
const ITEMS: &[(&str, &str, Option<&str>)] = &[
    ("new_note", "新建笔记", Some("CmdOrCtrl+N")),
    ("open_vault", "打开笔记库…", Some("CmdOrCtrl+O")),
    ("save", "保存", Some("CmdOrCtrl+S")),
    ("delete_note", "移到废纸篓", Some("CmdOrCtrl+Backspace")),
    ("undo", "撤销", Some("CmdOrCtrl+Z")),
    ("redo", "重做", Some("Shift+CmdOrCtrl+Z")),
    ("find", "查找", Some("CmdOrCtrl+F")),
    ("format_bold", "粗体", Some("CmdOrCtrl+B")),
    ("format_italic", "斜体", Some("CmdOrCtrl+I")),
    ("format_code", "行内代码", Some("CmdOrCtrl+E")),
    ("format_link", "链接", Some("CmdOrCtrl+K")),
    ("format_strike", "删除线", Some("Shift+CmdOrCtrl+X")),
    ("mode_editor", "只显示编辑器", Some("CmdOrCtrl+1")),
    ("mode_split", "分栏", Some("CmdOrCtrl+\\")),
    ("mode_preview", "只显示预览", Some("CmdOrCtrl+3")),
];

fn item(app: &AppHandle<Wry>, id: &str) -> tauri::Result<MenuItem<Wry>> {
    let (id, label, accelerator) = ITEMS
        .iter()
        .find(|(item_id, _, _)| *item_id == id)
        .expect("menu item is declared in ITEMS");
    MenuItem::with_id(app, *id, *label, true, *accelerator)
}

pub fn build(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let name = app.package_info().name.clone();

    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&format!("关于 {name}")), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("退出 {name}")))?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &item(app, "new_note")?,
            &item(app, "open_vault")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "save")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "delete_note")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &item(app, "undo")?,
            &item(app, "redo")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "find")?,
        ],
    )?;

    let format = Submenu::with_items(
        app,
        "格式",
        true,
        &[
            &item(app, "format_bold")?,
            &item(app, "format_italic")?,
            &item(app, "format_strike")?,
            &item(app, "format_code")?,
            &item(app, "format_link")?,
        ],
    )?;

    // Radio behaviour is the web side's: it owns the list and the order the
    // reader last chose.
    let sort = Submenu::with_items(
        app,
        "排序",
        true,
        &[
            &MenuItem::with_id(app, "sort_modified", "按修改时间", true, None::<&str>)?,
            &MenuItem::with_id(app, "sort_created", "按创建时间", true, None::<&str>)?,
            &MenuItem::with_id(app, "sort_title", "按标题", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sort_desc", "切换升降序", true, None::<&str>)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &item(app, "mode_editor")?,
            &item(app, "mode_split")?,
            &item(app, "mode_preview")?,
            &PredefinedMenuItem::separator(app)?,
            &sort,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &format, &view, &window])
}

/// Sends the chosen item to the window that has the keyboard.
pub fn emit(app: &AppHandle<Wry>, id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(MENU_EVENT, id);
    }
}
