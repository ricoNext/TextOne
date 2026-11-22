//! The vault: a folder of `.md` files that TextOne reads and writes.
//!
//! The rules come from MiaoYan's file layer, minus its accidents:
//! - a note is a plain `.md` file; the file name is the title, and a "/" in the
//!   title is stored as ":" because macOS will not take a solidus in a name;
//! - writes are atomic: the new bytes land in a temp file in the same folder
//!   and are renamed over the note, so a crash never leaves half a file;
//! - a write carries the modification time it was based on, and refuses when
//!   the file has changed since, instead of overwriting someone else's edit;
//! - a read-only note is read, never written.
//!
//! Attachment folders (`i`, `files`), hidden folders and `Trash` are not part
//! of the tree, as in MiaoYan's sidebar.

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Folder names that hold attachments or caches rather than notes.
const SKIPPED_DIRS: [&str; 4] = [".cache", "i", ".Trash", "files"];

/// Deep enough for any real library, shallow enough that a symlink loop or a
/// stray home directory cannot walk forever.
const MAX_DEPTH: usize = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRow {
    pub path: String,
    pub name: String,
    pub depth: u32,
    pub has_children: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub modified: i64,
    pub created: i64,
    /// The opening of the note, stripped of markup, for the list.
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub root: String,
    pub folders: Vec<FolderRow>,
    pub notes: Vec<NoteMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteBody {
    pub body: String,
    pub modified: i64,
    /// True when the file cannot be written: a read-only file, or a folder the
    /// process may not write to.
    pub readonly: bool,
}

/// The library TextOne opens when nothing else has been chosen.
///
/// `~/Documents/TextOne` rather than MiaoYan's container: a separate app owns a
/// separate folder, and the user can see it in Finder without hunting.
pub fn default_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Documents").join("TextOne")
}

/// Creates the library on first launch and drops a welcome note in it, so the
/// window never opens on an empty list with no explanation.
pub fn ensure_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("无法创建笔记库：{error}"))?;
    let welcome = root.join("欢迎使用 TextOne.md");
    if !welcome.exists() {
        let body = WELCOME;
        fs::write(&welcome, body).map_err(|error| format!("无法写入欢迎笔记：{error}"))?;
    }
    Ok(())
}

pub fn scan(root: &Path) -> Result<Vault, String> {
    scan_with(root, true)
}

/// `with_snippets` off for search, which reads the bodies itself: one pass
/// over the library is enough.
pub fn scan_with(root: &Path, with_snippets: bool) -> Result<Vault, String> {
    if !root.is_dir() {
        return Err(format!("笔记库不存在：{}", root.display()));
    }

    let mut folders = Vec::new();
    let mut notes = Vec::new();
    walk(root, root, 0, with_snippets, &mut folders, &mut notes)?;

    // MiaoYan sorts the sidebar by localized name, case-insensitively.
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(Vault {
        root: root.display().to_string(),
        folders,
        notes,
    })
}

fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    with_snippets: bool,
    folders: &mut Vec<FolderRow>,
    notes: &mut Vec<NoteMeta>,
) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // A folder that vanishes or is unreadable mid-scan must not fail the
        // whole library: the rest of the tree is still worth showing.
        Err(_) => return Ok(()),
    };

    let mut children: Vec<PathBuf> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            if SKIPPED_DIRS.contains(&name.as_str()) || depth >= MAX_DEPTH {
                continue;
            }
            children.push(path);
            continue;
        }

        if !metadata.is_file() || !is_markdown(&name) {
            continue;
        }

        let modified = millis(metadata.modified().ok());
        let created = millis(metadata.created().ok()).min(modified);
        notes.push(NoteMeta {
            path: path.display().to_string(),
            title: title_of(&path),
            folder: dir.display().to_string(),
            modified,
            created,
            snippet: if with_snippets { snippet_of(&path) } else { String::new() },
        });
    }

    children.sort_by(|a, b| {
        name_of(a)
            .to_lowercase()
            .cmp(&name_of(b).to_lowercase())
    });

    for child in children {
        let has_children = has_subfolder(&child);
        folders.push(FolderRow {
            path: child.display().to_string(),
            name: name_of(&child),
            depth: depth as u32,
            has_children,
        });
        walk(root, &child, depth + 1, with_snippets, folders, notes)?;
    }

    let _ = root;
    Ok(())
}

/// The first readable paragraph of a note, with the markup taken out: what a
/// list row shows under the title. Reads a head of the file, not all of it.
pub fn snippet_of(path: &Path) -> String {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };
    // Read a head, not the note: a scan must not pull ten megabytes off the
    // disk to fill two lines of a list row.
    let mut buffer = [0u8; 4096];
    let read = match file.read(&mut buffer) {
        Ok(read) => read,
        Err(_) => return String::new(),
    };
    let head = String::from_utf8_lossy(&buffer[..read]);
    snippet_from(&head.chars().take(1600).collect::<String>())
}

fn snippet_from(text: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    let mut started = false;
    // YAML frontmatter, only at the very top: everything up to the closing
    // rule is metadata, not prose.
    let mut in_frontmatter = false;
    let mut frontmatter_seen = false;

    for line in text.lines() {
        let trimmed = line.trim();

        if !frontmatter_seen && !started && (trimmed == "---" || trimmed == "+++") {
            in_frontmatter = true;
            frontmatter_seen = true;
            continue;
        }
        if in_frontmatter {
            if trimmed == "---" || trimmed == "+++" {
                in_frontmatter = false;
            }
            continue;
        }

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with("<!--") {
            continue;
        }
        if trimmed.starts_with('|') && trimmed.chars().all(|ch| "|-: ".contains(ch)) {
            continue;
        }
        started = true;

        let cleaned = strip_inline(trimmed);
        if cleaned.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&cleaned);
        if out.chars().count() >= 90 {
            break;
        }
    }

    let mut result: String = out.chars().take(90).collect();
    if out.chars().count() > 90 {
        result.push('…');
    }
    result
}

/// Removes the markup a reader should not see in a one-line summary.
fn strip_inline(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];

        // Leading block markers: #, >, -, *, +, 1.
        if ch == '#' || ch == '>' {
            index += 1;
            continue;
        }
        if (ch == '-' || ch == '*' || ch == '+') && out.is_empty() {
            index += 1;
            continue;
        }
        if ch.is_ascii_digit() && out.is_empty() {
            let mut look = index;
            while look < chars.len() && chars[look].is_ascii_digit() {
                look += 1;
            }
            if look < chars.len() && (chars[look] == '.' || chars[look] == ')') {
                index = look + 1;
                continue;
            }
        }

        // Images vanish; links keep their text.
        if ch == '!' && chars.get(index + 1) == Some(&'[') {
            if let Some(end) = skip_link(&chars, index + 1) {
                index = end;
                continue;
            }
        }
        if ch == '[' && chars.get(index + 1) != Some(&'[') {
            if let Some((text, end)) = link_text(&chars, index) {
                out.push_str(&text);
                index = end;
                continue;
            }
        }

        // Checkboxes, table pipes and the emphasis/backtick marks.
        if ch == '[' && matches!(chars.get(index + 1), Some(' ') | Some('x') | Some('X')) {
            if chars.get(index + 2) == Some(&']') {
                index += 3;
                continue;
            }
        }
        if matches!(ch, '*' | '_' | '~' | '`' | '|') {
            index += 1;
            continue;
        }

        out.push(ch);
        index += 1;
    }

    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn skip_link(chars: &[char], open: usize) -> Option<usize> {
    let mut index = open;
    let mut depth = 0;
    while index < chars.len() {
        match chars[index] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    let mut end = index + 1;
                    if chars.get(end) == Some(&'(') {
                        while end < chars.len() && chars[end] != ')' {
                            end += 1;
                        }
                        return Some((end + 1).min(chars.len()));
                    }
                    return Some(end);
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn link_text(chars: &[char], open: usize) -> Option<(String, usize)> {
    let end = skip_link(chars, open)?;
    let mut label = String::new();
    for &ch in chars.iter().take(end).skip(open + 1) {
        if ch == ']' {
            break;
        }
        label.push(ch);
    }
    Some((label, end))
}

fn has_subfolder(dir: &Path) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = name_of(&path);
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
            && !name.starts_with('.')
            && !SKIPPED_DIRS.contains(&name.as_str())
        {
            return true;
        }
    }
    false
}

fn is_markdown(name: &str) -> bool {
    name.to_lowercase().ends_with(".md")
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string()
}

/// The note's title is its file stem, with the stored ":" put back, as
/// `Note.getTitleWithoutLabel` does.
pub fn title_of(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    stem.replace(':', "/")
}

pub fn read(path: &Path) -> Result<NoteBody, String> {
    let bytes = fs::read(path).map_err(|error| format!("无法读取笔记：{error}"))?;
    // Invalid UTF-8 is shown with replacement characters, as `NoteText.decode`
    // does; the caller then refuses to write the damaged text back.
    let body = String::from_utf8_lossy(&bytes).to_string();
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取笔记信息：{error}"))?;
    Ok(NoteBody {
        body,
        modified: millis(metadata.modified().ok()),
        readonly: !is_writable(path, &metadata),
    })
}

/// Writes `body` over `path` atomically, refusing when the file changed since
/// `expected_modified` (0 means "no check", used for a brand-new note).
pub fn write(path: &Path, body: &str, expected_modified: i64) -> Result<i64, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("笔记不存在：{error}"))?;
    if !is_writable(path, &metadata) {
        return Err("这篇笔记是只读的，没有写入".into());
    }

    let current = millis(metadata.modified().ok());
    if expected_modified != 0 && current != expected_modified {
        return Err("笔记在磁盘上被改过，已停止写入以免覆盖".into());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "笔记路径没有上级目录".to_string())?;
    let name = name_of(path);
    let temp = parent.join(format!(".{name}.textone-tmp"));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(body.as_bytes())?;
        // The rename is only atomic once the bytes are on the platter.
        file.sync_all()?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(format!("无法写入笔记：{error}"));
    }

    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("无法保存笔记：{error}"));
    }

    let modified = fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(|time| millis(Some(time)))
        .unwrap_or_else(|| millis(Some(SystemTime::now())));
    Ok(modified)
}

/// Creates an empty note in `folder`, picking a name that does not collide.
pub fn create(folder: &Path, title: &str) -> Result<NoteMeta, String> {
    if !folder.is_dir() {
        return Err(format!("文件夹不存在：{}", folder.display()));
    }
    let clean = if title.trim().is_empty() {
        "无标题".to_string()
    } else {
        title.trim().to_string()
    }
    .replace('/', ":");

    let mut candidate = folder.join(format!("{clean}.md"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = folder.join(format!("{clean} {counter}.md"));
        counter += 1;
        if counter > 999 {
            return Err("同名笔记太多，换个标题吧".into());
        }
    }

    fs::write(&candidate, "").map_err(|error| format!("无法新建笔记：{error}"))?;
    let metadata = fs::metadata(&candidate).map_err(|error| format!("无法读取新笔记：{error}"))?;
    let modified = millis(metadata.modified().ok());

    Ok(NoteMeta {
        path: candidate.display().to_string(),
        title: title_of(&candidate),
        folder: folder.display().to_string(),
        modified,
        created: modified,
        snippet: String::new(),
    })
}

/// Saves a pasted or dropped file beside the note, in `i/`, and returns the
/// path to write into the markdown. `i` is what MiaoYan uses and what the
/// library scan already skips.
pub fn save_attachment(note_path: &Path, data: &[u8], extension: &str) -> Result<String, String> {
    let folder = note_path
        .parent()
        .ok_or_else(|| "笔记路径没有上级目录".to_string())?
        .join("i");
    fs::create_dir_all(&folder).map_err(|error| format!("无法创建图片目录：{error}"))?;

    let extension = sanitize_extension(extension);
    let base = stamp(now_millis());
    let mut name = format!("{base}.{extension}");
    let mut counter = 2;
    while folder.join(&name).exists() {
        name = format!("{base}-{counter}.{extension}");
        counter += 1;
        if counter > 999 {
            return Err("同一秒内图片太多".into());
        }
    }

    fs::write(folder.join(&name), data).map_err(|error| format!("无法写入图片：{error}"))?;
    Ok(format!("i/{name}"))
}

fn sanitize_extension(extension: &str) -> String {
    let cleaned: String = extension
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(5)
        .collect::<String>()
        .to_ascii_lowercase();
    match cleaned.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "svg" | "avif" => cleaned,
        "" => "png".into(),
        _ => "png".into(),
    }
}

fn now_millis() -> i64 {
    millis(Some(SystemTime::now()))
}

/// `2026-11-20-181500`: readable in Finder, sortable, and unique enough that
/// two pastes in the same second fall to the counter.
fn stamp(millis: i64) -> String {
    let seconds = millis.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = time / 3600;
    let minute = (time % 3600) / 60;
    let second = time % 60;
    format!("{year:04}-{month:02}-{day:02}-{hour:02}{minute:02}{second:02}")
}

/// Howard Hinnant's civil-from-days: epoch days to a calendar date without a
/// date library.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub modified: i64,
    /// The line the match sits on, trimmed for the list.
    pub snippet: String,
    pub line: u32,
}

/// Full-text search across the library. Notes are small and few; reading them
/// on a keystroke beats keeping an index in step with files edited by hand.
pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let vault = scan_with(root, false)?;
    let mut hits: Vec<SearchHit> = Vec::new();

    for note in vault.notes {
        if hits.len() >= limit {
            break;
        }
        if note.title.to_lowercase().contains(&needle) {
            hits.push(SearchHit {
                path: note.path,
                title: note.title,
                folder: note.folder,
                modified: note.modified,
                snippet: String::new(),
                line: 1,
            });
            continue;
        }

        let body = match fs::read_to_string(&note.path) {
            Ok(body) => body,
            // A file that cannot be read as UTF-8 is skipped rather than
            // shown with mangled text.
            Err(_) => continue,
        };
        for (index, line) in body.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                hits.push(SearchHit {
                    path: note.path,
                    title: note.title,
                    folder: note.folder,
                    modified: note.modified,
                    snippet: excerpt(line, &needle),
                    line: index as u32 + 1,
                });
                break;
            }
        }
    }

    Ok(hits)
}

/// The matched line, cut to a readable width around the match.
fn excerpt(line: &str, needle: &str) -> String {
    let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = collapsed.to_lowercase();
    let Some(position) = lower.find(needle) else {
        return truncate(&collapsed, 120);
    };
    // Two short lines of context, so the match is not at the very edge.
    let start = collapsed[..position].char_indices().rev().nth(20).map(|(i, _)| i).unwrap_or(0);
    let cut = &collapsed[start..];
    truncate(cut, 120)
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// Renames a note: the title is the file name, so editing the title moves the
/// file. A ":" stands in for the "/" a title may contain.
pub fn rename(path: &Path, title: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "笔记路径没有上级目录".to_string())?;
    let clean = title.trim().replace('/', ":");
    if clean.is_empty() {
        return Err("标题不能为空".into());
    }

    let mut candidate = parent.join(format!("{clean}.md"));
    if candidate == path {
        return Ok(candidate);
    }
    let mut counter = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{clean} {counter}.md"));
        counter += 1;
        if counter > 999 {
            return Err("同名笔记太多，换个标题吧".into());
        }
    }

    fs::rename(path, &candidate).map_err(|error| format!("无法重命名：{error}"))?;
    Ok(candidate)
}

/// Copies a note beside itself, named "<title> 副本".
pub fn duplicate(path: &Path) -> Result<NoteMeta, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "笔记路径没有上级目录".to_string())?;
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("笔记");

    let mut candidate = parent.join(format!("{stem} 副本.md"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} 副本 {counter}.md"));
        counter += 1;
        if counter > 999 {
            return Err("副本太多，换个名字吧".into());
        }
    }

    fs::copy(path, &candidate).map_err(|error| format!("无法制作副本：{error}"))?;
    let metadata = fs::metadata(&candidate).map_err(|error| format!("无法读取副本：{error}"))?;
    let modified = millis(metadata.modified().ok());

    Ok(NoteMeta {
        path: candidate.display().to_string(),
        title: title_of(&candidate),
        folder: parent.display().to_string(),
        modified,
        created: modified,
        snippet: snippet_of(&candidate),
    })
}

/// Shows the note in Finder with `open -R`, which reveals rather than opens.
pub fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在 Finder 中显示：{error}"))
}

/// Moves a note to the user's Trash, where Finder can put it back. Deleting
/// outright is not offered: a mis-click must stay recoverable.
pub fn trash(path: &Path) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    trash_into(path, &PathBuf::from(home).join(".Trash"))
}

/// The body of `trash`, with the destination passed in so a test never touches
/// the real Trash.
pub fn trash_into(path: &Path, trash_dir: &Path) -> Result<(), String> {
    let name = name_of(path);
    let mut target = trash_dir.join(&name);

    // The Trash may already hold a file with this name; the Finder suffixes
    // rather than replacing.
    let mut counter = 1;
    while target.exists() {
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("笔记");
        target = trash_dir.join(format!("{stem} {counter}.md"));
        counter += 1;
        if counter > 999 {
            return Err("废纸篓里同名文件太多".into());
        }
    }

    fs::rename(path, &target).map_err(|error| format!("无法移到废纸篓：{error}"))
}

fn is_writable(path: &Path, metadata: &fs::Metadata) -> bool {
    if metadata.permissions().readonly() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o200 == 0 {
            return false;
        }
        // A writable file in a folder that cannot be written cannot be
        // replaced either, and the write is a rename.
        if let Some(parent) = path.parent() {
            if let Ok(dir) = fs::metadata(parent) {
                if dir.permissions().mode() & 0o200 == 0 {
                    return false;
                }
            }
        }
    }
    true
}

fn millis(time: Option<SystemTime>) -> i64 {
    time.and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Rejects a path outside the library, so a command can never be talked into
/// writing somewhere else.
pub fn within(root: &Path, candidate: &Path) -> bool {
    let root = normalize(root);
    let candidate = normalize(candidate);
    candidate.starts_with(&root)
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

const WELCOME: &str = r#"# 欢迎使用 TextOne

这是一个把 Markdown 存成本地文件的编辑器。你的笔记就是这个文件夹里的 `.md` 文件，
用任何别的工具都能打开。

## 试试这些

- [ ] 按 ⌘N 新建一篇
- [ ] 在这里打字，右侧看排版
- [ ] 按 ⌘S 立刻保存（平时会自动保存）

> 写作工具能做的只有一件事：别打断。

## 语法都在

| 能力 | 说明 |
|---|---|
| 表格 | 像上面这张 |
| 任务 | 上面那两个方框 |
| 代码 | 下面这段 |

```ts
const note = "Markdown 存本地";
```
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("textone-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_reads_folders_and_skips_attachments() {
        let root = scratch("scan");
        fs::create_dir_all(root.join("笔记/子目录")).unwrap();
        fs::create_dir_all(root.join("i")).unwrap();
        fs::create_dir_all(root.join(".cache")).unwrap();
        fs::write(root.join("根笔记.md"), "# 一").unwrap();
        fs::write(root.join("笔记/嵌套.md"), "# 二").unwrap();
        fs::write(root.join("笔记/子目录/更深.md"), "# 三").unwrap();
        fs::write(root.join("i/图片.md"), "不该出现").unwrap();
        fs::write(root.join(".cache/缓存.md"), "不该出现").unwrap();
        fs::write(root.join("笔记/说明.txt"), "不是笔记").unwrap();

        let vault = scan(&root).unwrap();
        let titles: Vec<_> = vault.notes.iter().map(|n| n.title.as_str()).collect();
        assert_eq!(titles.len(), 3, "{titles:?}");
        assert!(titles.contains(&"根笔记"));
        assert!(titles.contains(&"嵌套"));
        assert!(titles.contains(&"更深"));

        let names: Vec<_> = vault.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["子目录", "笔记"], "子目录排在笔记前面？{names:?}");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_is_atomic_and_bumps_the_time() {
        let root = scratch("write");
        let note = root.join("a.md");
        fs::write(&note, "旧").unwrap();
        let before = read(&note).unwrap();

        // Coarse file systems stamp whole seconds; move the clock on before
        // expecting a different value.
        std::thread::sleep(Duration::from_millis(20));
        let after = write(&note, "新内容", before.modified).unwrap();

        assert_eq!(read(&note).unwrap().body, "新内容");
        assert!(after >= before.modified);
        // The temp file must not survive the rename.
        assert!(!root.join(".a.md.textone-tmp").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_refuses_a_stale_buffer() {
        let root = scratch("conflict");
        let note = root.join("b.md");
        fs::write(&note, "第一版").unwrap();
        let seen = read(&note).unwrap();

        std::thread::sleep(Duration::from_millis(20));
        // Someone else writes the file after we read it.
        write(&note, "别人写的", seen.modified).unwrap();

        let result = write(&note, "我的草稿", seen.modified);
        assert!(result.is_err(), "过期缓冲区不该写进去");
        assert_eq!(read(&note).unwrap().body, "别人写的");
        fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn write_refuses_a_read_only_note() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("readonly");
        let note = root.join("c.md");
        fs::write(&note, "不可改").unwrap();
        fs::set_permissions(&note, fs::Permissions::from_mode(0o444)).unwrap();

        let loaded = read(&note).unwrap();
        assert!(loaded.readonly, "只读文件要标出来");
        assert!(write(&note, "改一下", loaded.modified).is_err());

        fs::set_permissions(&note, fs::Permissions::from_mode(0o644)).ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_picks_a_free_name() {
        let root = scratch("create");
        fs::write(root.join("无标题.md"), "").unwrap();
        let meta = create(&root, "无标题").unwrap();
        assert!(meta.path.ends_with("无标题 2.md"), "{}", meta.path);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rename_moves_the_file_and_keeps_the_title() {
        let root = scratch("rename");
        let note = root.join("旧标题.md");
        fs::write(&note, "内容").unwrap();
        fs::write(root.join("新标题.md"), "占位").unwrap();

        // A taken name gets a suffix rather than overwriting the other note.
        let renamed = rename(&note, "新标题").unwrap();
        assert!(renamed.ends_with("新标题 2.md"), "{}", renamed.display());
        assert_eq!(read(&renamed).unwrap().body, "内容");
        assert_eq!(read(&root.join("新标题.md")).unwrap().body, "占位");

        // A "/" in the title is stored as ":".
        let with_slash = rename(&renamed, "a/b").unwrap();
        assert_eq!(title_of(&with_slash), "a/b");
        assert!(with_slash.file_name().unwrap().to_str().unwrap().contains(':'));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn trash_moves_the_note_aside() {
        let root = scratch("trash");
        let bin = scratch("bin");
        let note = root.join("丢掉.md");
        fs::write(&note, "还在").unwrap();

        trash_into(&note, &bin).unwrap();
        assert!(!note.exists());
        assert_eq!(fs::read_to_string(bin.join("丢掉.md")).unwrap(), "还在");

        // The same name twice must not overwrite what is already in the bin.
        fs::write(&note, "第二篇").unwrap();
        trash_into(&note, &bin).unwrap();
        assert_eq!(fs::read_to_string(bin.join("丢掉 1.md")).unwrap(), "第二篇");

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&bin).ok();
    }

    #[test]
    fn search_finds_a_title_and_a_line() {
        let root = scratch("search");
        fs::create_dir_all(root.join("写作")).unwrap();
        fs::write(
            root.join("写作/关于慢.md"),
            "写字这件事，快不起来。\n工具能做的只有一件事：别打断。\n",
        )
        .unwrap();
        fs::write(root.join("Writing.md"), "Nothing here\n").unwrap();

        let by_title = search(&root, "关于", 10).unwrap();
        assert_eq!(by_title.len(), 1, "{by_title:?}");
        assert_eq!(by_title[0].title, "关于慢");

        let by_body = search(&root, "别打断", 10).unwrap();
        assert_eq!(by_body.len(), 1);
        assert_eq!(by_body[0].line, 2);
        assert!(by_body[0].snippet.contains("别打断"), "{}", by_body[0].snippet);

        // Case does not matter, and the limit is honoured.
        assert_eq!(search(&root, "NOTHING", 10).unwrap().len(), 1);
        assert_eq!(search(&root, "e", 1).unwrap().len(), 1);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_attachment_lands_in_the_note_folder() {
        let root = scratch("attach");
        let note = root.join("a.md");
        fs::write(&note, "# a").unwrap();

        let first = save_attachment(&note, b"png-bytes", "PNG").unwrap();
        assert!(first.starts_with("i/"), "{first}");
        assert!(first.ends_with(".png"), "{first}");
        assert_eq!(fs::read(root.join(&first)).unwrap(), b"png-bytes");

        // Two in the same second must not overwrite each other.
        let second = save_attachment(&note, b"other", "jpeg").unwrap();
        assert_ne!(first, second);

        // An unknown extension falls back to png rather than the disk's.
        let odd = save_attachment(&note, b"x", "../../evil").unwrap();
        assert!(odd.ends_with(".png"), "{odd}");
        assert!(!odd.contains(".."), "{odd}");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_snippet_drops_the_markup() {
        let root = scratch("snippet");
        let note = root.join("a.md");
        fs::write(
            &note,
            "---\ntags: x\n---\n# 标题\n\n这是**正文**，带 [链接](https://example.com) 和 ![图](i/a.png)。\n\n```\nlet code = 1;\n```\n",
        )
        .unwrap();

        let vault = scan(&root).unwrap();
        let snippet = &vault.notes[0].snippet;
        assert!(snippet.contains("这是正文"), "{snippet}");
        assert!(!snippet.contains("**"), "{snippet}");
        assert!(!snippet.contains("https://"), "{snippet}");
        assert!(!snippet.contains("tags"), "{snippet}");
        assert!(!snippet.contains("let code"), "{snippet}");
        assert!(!snippet.contains("!["), "{snippet}");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_duplicate_sits_beside_its_original() {
        let root = scratch("duplicate");
        let note = root.join("想法.md");
        fs::write(&note, "# 想法\n正文").unwrap();

        let copy = duplicate(&note).unwrap();
        assert!(copy.path.ends_with("想法 副本.md"), "{}", copy.path);
        assert_eq!(read(Path::new(&copy.path)).unwrap().body, "# 想法\n正文");
        // The original is untouched.
        assert_eq!(read(&note).unwrap().body, "# 想法\n正文");

        // A second copy does not overwrite the first.
        let again = duplicate(&note).unwrap();
        assert_ne!(copy.path, again.path);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn paths_outside_the_library_are_rejected() {
        let root = PathBuf::from("/tmp/typed-notes");
        assert!(within(&root, &root.join("a/b.md")));
        assert!(!within(&root, Path::new("/tmp/typed-notes-evil/a.md")));
        assert!(!within(&root, Path::new("/tmp/typed-notes/../../etc/passwd")));
    }
}
