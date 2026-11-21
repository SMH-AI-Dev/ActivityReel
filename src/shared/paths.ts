/**
 * Path helpers shared by the store and the exporters.
 *
 * Events may only carry workspace-relative paths (and names); anything that looks like an
 * absolute path or a `file:` URI must be dropped before it is stored or exported.
 */

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const UNC_ABSOLUTE = /^\\\\/;
const FILE_URI = /^file:/i;
const HOME_RELATIVE = /^~[\\/]/;

/**
 * True when `path` looks like an absolute filesystem path or a URI: drive-absolute (`C:/`, `C:\`),
 * UNC (`\\server`), `file:` URIs, `~/` home-relative paths, and POSIX-style paths whose leading
 * slash is followed by a segment and another separator (`/src/a.ts`, `/home/me`) are all rejected.
 * A single-segment leading-slash name (`/src`) is allowed.
 */
export function looksAbsolute(path: string): boolean {
  if (path.length === 0) return false;
  return (
    WINDOWS_ABSOLUTE.test(path) ||
    UNC_ABSOLUTE.test(path) ||
    FILE_URI.test(path) ||
    HOME_RELATIVE.test(path) ||
    /^\/[^/]+\//.test(path)
  );
}
