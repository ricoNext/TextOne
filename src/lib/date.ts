/** The list's date, ported from `NoteListDate.short` in MiaoYanCore:
 *  today shows the time, yesterday the word, this year the month and day,
 *  anything older the full date. The app's language decides the form, not the
 *  system's, so the string is built here rather than with a locale guess. */

export type Lang = "zh" | "en";

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function shortDate(
  epochMs: number,
  lang: Lang,
  now: Date = new Date(),
): string {
  const date = new Date(epochMs);

  if (isSameDay(date, now)) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return lang === "zh" ? "昨天" : "Yesterday";

  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (date.getFullYear() === now.getFullYear()) {
    return lang === "zh" ? `${m}月${d}日` : `${monthName(m, lang)} ${d}`;
  }

  return lang === "zh"
    ? `${date.getFullYear()}年${m}月${d}日`
    : `${monthName(m, lang)} ${d}, ${date.getFullYear()}`;
}

const EN_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthName(month: number, lang: Lang): string {
  return lang === "zh" ? `${month}月` : EN_MONTHS[month - 1];
}

/** "12 分钟前" for the note header's tooltip; MiaoYan shows the raw timestamp
 *  there, which reads poorly in a tooltip. */
export function fullTimestamp(epochMs: number, lang: Lang): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return lang === "zh" ? `${date} ${time}` : `${date} ${time}`;
}
