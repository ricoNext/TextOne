/** Path helpers for the absolute, `/`-separated paths the file layer returns. */

/** The folder a file sits in. */
export function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : path;
}

/** Resolves `relative` against `directory`, collapsing `.` and `..`. */
export function joinPath(directory: string, relative: string): string {
  const parts = directory.split("/").filter(Boolean);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return "/" + parts.join("/");
}
