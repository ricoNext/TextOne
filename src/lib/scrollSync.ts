/** Line-to-offset indexing shared by the editor and the preview.
 *
 *  Percentages drift: two documents of the same text do not have the same
 *  height, and one with a diagram does not have the same height as its source.
 *  MiaoYan indexes every block by its source line and interpolates between
 *  neighbours, which is also what VS Code does. */

export interface Mark {
  line: number;
  top: number;
}

export function buildIndex(
  elements: ArrayLike<Element>,
  offsetOf: (element: Element) => number,
  lineOf: (element: Element) => number,
): Mark[] {
  const marks: Mark[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const line = lineOf(element);
    if (!Number.isFinite(line)) continue;
    const top = offsetOf(element);
    // Two blocks can start on the same line (a list item and its text).
    if (marks.length && marks[marks.length - 1].line === line) continue;
    marks.push({ line, top });
  }
  marks.sort((a, b) => a.line - b.line);
  return marks;
}

/** The offset a line should sit at, interpolated between the blocks around it. */
export function offsetForLine(marks: Mark[], line: number): number {
  if (marks.length === 0) return 0;
  if (line <= marks[0].line) return marks[0].top;

  let low = 0;
  let high = marks.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (marks[mid].line <= line) low = mid;
    else high = mid - 1;
  }

  const current = marks[low];
  const next = marks[low + 1];
  if (!next) return current.top;
  const span = next.line - current.line;
  if (span <= 0) return current.top;
  const ratio = (line - current.line) / span;
  return current.top + (next.top - current.top) * ratio;
}

/** The line at an offset: the inverse of `offsetForLine`. */
export function lineForOffset(marks: Mark[], offset: number): number {
  if (marks.length === 0) return 1;
  if (offset <= marks[0].top) return marks[0].line;

  let low = 0;
  let high = marks.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (marks[mid].top <= offset) low = mid;
    else high = mid - 1;
  }

  const current = marks[low];
  const next = marks[low + 1];
  if (!next) return current.line;
  const span = next.top - current.top;
  if (span <= 0) return current.line;
  const ratio = (offset - current.top) / span;
  return Math.round(current.line + (next.line - current.line) * ratio);
}
