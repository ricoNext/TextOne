//! Markdown to HTML, for the preview island.
//!
//! MiaoYan renders with cmark-gfm and then runs a handful of passes over the
//! result. This does the same job with comrak (pure Rust, no C toolchain) and
//! keeps the two passes that change what the reader sees: formulas must reach
//! KaTeX untouched, and every block keeps its `data-sourcepos` so the preview
//! can be scrolled in step with the editor.
//!
//! Formula protection is the part worth reading: markdown would eat the `*`
//! and `_` inside `$a*b$` and turn a display block into paragraphs with `<br>`
//! in it. Each formula is swapped for a token before parsing and put back
//! verbatim afterwards, so KaTeX's `$…$` / `$$…$$` / `\(…\)` / `\[…\]`
//! delimiters arrive exactly as typed.

use comrak::{markdown_to_html, Options};

pub fn render(markdown: &str, hard_breaks: bool) -> String {
    let (protected, formulas) = protect_formulas(markdown);

    let mut options = Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.alerts = true;
    options.extension.header_ids = None;
    options.parse.smart = false;
    // CMARK_OPT_HARDBREAKS / CMARK_OPT_NOBREAKS: a single newline either
    // breaks the line or joins it, per the editor's preference.
    options.render.hardbreaks = hard_breaks;
    // CMARK_OPT_UNSAFE: notes carry raw HTML on purpose.
    options.render.r#unsafe = true;
    // CMARK_OPT_SOURCEPOS: the scroll sync's only anchor.
    options.render.sourcepos = true;

    let html = markdown_to_html(&protected, &options);
    restore_formulas(&html, &formulas)
}

/// A formula found in the source, kept verbatim until the HTML is built.
struct Formula {
    /** The delimiters plus the body, as KaTeX must see it. */
    text: String,
}

/// The token a formula is replaced with. Private-use code points survive both
/// the parser and the HTML writer untouched.
fn token(index: usize) -> String {
    format!("\u{E000}{index}\u{E001}")
}

fn protect_formulas(markdown: &str) -> (String, Vec<Formula>) {
    let bytes = markdown.as_bytes();
    let mut out = String::with_capacity(markdown.len());
    let mut formulas: Vec<Formula> = Vec::new();
    let mut index = 0;
    let mut fence: Option<usize> = None; // number of backticks of the open fence
    let mut line_start = true;

    while index < bytes.len() {
        // Fenced code: formulas inside it are text, not math.
        if line_start {
            let rest = &markdown[index..];
            let ticks = rest.chars().take_while(|c| *c == '`').count();
            if ticks >= 3 {
                match fence {
                    Some(open) if open == ticks => fence = None,
                    None => fence = Some(ticks),
                    _ => {}
                }
            }
            line_start = false;
        }

        let ch = markdown[index..].chars().next().unwrap();

        if fence.is_some() {
            out.push(ch);
            index += ch.len_utf8();
            line_start = ch == '\n';
            continue;
        }

        // Inline code spans are text too.
        if ch == '`' {
            let ticks = markdown[index..].chars().take_while(|c| *c == '`').count();
            if let Some(end) = find_code_end(markdown, index, ticks) {
                out.push_str(&markdown[index..end]);
                index = end;
                continue;
            }
        }

        if ch == '\\' {
            // `\$5` is money, not math. `\(` and `\[` are not escapes here:
            // they open a formula and are handled below.
            let mut chars = markdown[index..].chars();
            chars.next();
            if let Some(next) = chars.next() {
                if next == '$' {
                    out.push_str(&markdown[index..index + ch.len_utf8() + next.len_utf8()]);
                    index += ch.len_utf8() + next.len_utf8();
                    continue;
                }
            }
        }

        if let Some(end) = match_formula(markdown, index) {
            let text = markdown[index..end].to_string();
            out.push_str(&token(formulas.len()));
            formulas.push(Formula { text });
            index = end;
            line_start = false;
            continue;
        }

        out.push(ch);
        index += ch.len_utf8();
        line_start = ch == '\n';
    }

    // A fence left open at the end of the document is not a fence; nothing to
    // undo, only the formulas already captured.
    let _ = fence;
    (out, formulas)
}

/// Matches one formula starting at `start`, returning the byte just past it.
fn match_formula(markdown: &str, start: usize) -> Option<usize> {
    let rest = &markdown[start..];

    for (open, close, allow_newline) in [
        ("$$", "$$", true),
        ("\\[", "\\]", true),
        ("\\(", "\\)", false),
        ("$", "$", false),
    ] {
        if !rest.starts_with(open) {
            continue;
        }
        // `$5` and `$ 5` are prices, not formulas.
        if open == "$" {
            let after = rest[1..].chars().next()?;
            if after.is_whitespace() || after.is_ascii_digit() {
                continue;
            }
        }
        let body_start = start + open.len();
        let mut cursor = body_start;
        while cursor < markdown.len() {
            let slice = &markdown[cursor..];
            if !allow_newline && slice.starts_with('\n') {
                return None;
            }
            if slice.starts_with(close) {
                // `$$` must not close a `$…$` span at its own start.
                let body = &markdown[body_start..cursor];
                if body.is_empty() {
                    return None;
                }
                return Some(cursor + close.len());
            }
            if slice.starts_with('\\') && !slice.starts_with("\\\n") {
                // Skip the escaped character so `\$` does not close a span.
                let mut chars = slice.chars();
                chars.next();
                let escape = chars.next()?;
                cursor += '\\'.len_utf8() + escape.len_utf8();
                continue;
            }
            let ch = slice.chars().next()?;
            cursor += ch.len_utf8();
        }
        return None;
    }
    None
}

fn find_code_end(markdown: &str, start: usize, ticks: usize) -> Option<usize> {
    let fence = "`".repeat(ticks);
    let mut cursor = start + ticks;
    while cursor < markdown.len() {
        match markdown[cursor..].find(&fence) {
            Some(offset) => {
                let end = cursor + offset + ticks;
                // A closing run must be exactly as long as the opening one.
                let longer = markdown[end..].starts_with('`');
                if longer {
                    cursor = end;
                    continue;
                }
                return Some(end);
            }
            None => return None,
        }
    }
    None
}

fn restore_formulas(html: &str, formulas: &[Formula]) -> String {
    if formulas.is_empty() {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len());
    let mut rest = html;

    while let Some(start) = rest.find('\u{E000}') {
        out.push_str(&rest[..start]);
        let after = &rest[start + '\u{E000}'.len_utf8()..];
        match after.find('\u{E001}') {
            Some(end) => {
                let index: usize = after[..end].parse().unwrap_or(usize::MAX);
                match formulas.get(index) {
                    Some(formula) => {
                        // Back to text for KaTeX: the delimiters are literal.
                        out.push_str(&escape_html(&formula.text));
                    }
                    None => out.push_str(&after[..end]),
                }
                rest = &after[end + '\u{E001}'.len_utf8()..];
            }
            None => {
                out.push_str(after);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_tables_and_tasks_come_out() {
        let html = render(
            "# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] 完成\n- [ ] 未完成\n",
            true,
        );
        assert!(html.contains("<h1"), "{html}");
        assert!(html.contains("<table "), "{html}");
        assert!(html.contains("type=\"checkbox\""), "{html}");
    }

    #[test]
    fn every_block_keeps_its_source_lines() {
        let html = render("# 一\n\n正文\n", true);
        assert!(html.contains("data-sourcepos=\"1:1-"), "缺少 sourcepos：{html}");
        assert!(html.contains("data-sourcepos=\"3:1-"), "缺少 sourcepos：{html}");
    }

    #[test]
    fn a_formula_is_not_eaten_by_markdown() {
        // `a*b*c` would become emphasis, and `_` would become italics.
        let html = render("行内 $a*b*c$ 与 $x_1$ 都在。", true);
        assert!(html.contains("$a*b*c$"), "{html}");
        assert!(!html.contains("<em>"), "公式里的星号被当成强调：{html}");
        assert!(html.contains("$x_1$"), "{html}");
    }

    #[test]
    fn a_display_block_stays_one_piece() {
        let html = render("$$\n\\int_0^1 x^2 dx\n$$", true);
        assert!(html.contains("$$"), "{html}");
        assert_eq!(html.matches("<p").count(), 1, "公式被拆成多段：{html}");
        assert!(!html.contains("<br"), "公式里被塞了换行：{html}");
    }

    #[test]
    fn formulas_inside_code_are_left_alone() {
        let html = render("```\n$a*b$\n```\n", true);
        assert!(html.contains("<code>"), "{html}");
        // The code block's dollars are text and must not become a formula.
        assert!(html.contains("$a*b$"), "{html}");
    }

    #[test]
    fn money_is_not_a_formula() {
        let html = render("这本书 $5，那本 $12。", true);
        assert!(html.contains("$5"), "{html}");
        assert!(html.contains("$12"), "{html}");
    }

    #[test]
    fn backslash_delimiters_survive() {
        let html = render("行内 \\(a+b\\) 与块 \\[c+d\\]", true);
        assert!(html.contains("\\(a+b\\)"), "{html}");
        assert!(html.contains("\\[c+d\\]"), "{html}");
    }
}
