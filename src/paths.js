import { relative, sep } from "node:path";

/**
 * Validates a normalized, repository-relative POSIX path.
 *
 * @param {unknown} path
 * @returns {string}
 */
export function validatePath(path) {
  if (
    typeof path !== "string" ||
    path === "" ||
    /[\\\r\n\0]/u.test(path) ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Expected a relative repository path: ${JSON.stringify(path)}.`);
  }
  return path;
}

/**
 * Converts an absolute file path into a validated path relative to a directory.
 *
 * @param {string} directory
 * @param {string} file
 * @returns {string}
 */
export function relativePath(directory, file) {
  return validatePath(relative(directory, file).split(sep).join("/"));
}
