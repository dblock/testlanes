import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "tinyglobby";
import { execute, framework } from "./frameworks.js";
import { relativePath, validatePath } from "./paths.js";

/**
 * Selects test files and records their sizes. The framework's own listing is
 * used unless a glob pattern is given, so include and exclude configuration is
 * respected.
 *
 * @param {{ framework: string, cwd: string, pattern?: string | null, testArgs?: string[] }} options
 * @returns {Promise<Record<string, number>>}
 */
export async function discover({ framework: name, cwd, pattern = null, testArgs = [] }) {
  const selected = framework(name);
  let files;
  if (pattern) {
    files = (await glob(pattern, { cwd, onlyFiles: true, expandDirectories: false })).map(validatePath);
  } else {
    const { code, stdout } = await execute(selected, selected.listArgs(testArgs), { cwd, capture: true });
    if (code !== 0) throw new Error(`Listing ${name} test files failed with exit code ${code}.`);
    files = selected.parseList(stdout).map((file) => relativePath(cwd, resolve(cwd, file)));
  }
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const file of [...new Set(files)].sort()) {
    sizes[file] = (await stat(resolve(cwd, file))).size;
  }
  return sizes;
}
