import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "tinyglobby";
import { execute, framework, nodeTestPatterns } from "./frameworks.js";
import { relativePath, validatePath } from "./paths.js";

/**
 * Selects test files and records their sizes. Vitest and Jest list their own
 * files, so include and exclude configuration is respected; node:test files
 * match the default `node --test` patterns. A glob pattern overrides both.
 *
 * @param {{ framework: string, cwd: string, pattern?: string | null, testArgs?: string[] }} options
 * @returns {Promise<Record<string, number>>}
 */
export async function discover({ framework: name, cwd, pattern = null, testArgs = [] }) {
  const selected = framework(name);
  let files;
  if (pattern || !selected.listArgs) {
    files = (await glob(pattern || nodeTestPatterns(), { cwd, onlyFiles: true, expandDirectories: false, ignore: pattern ? [] : ["**/node_modules/**"] })).map(validatePath);
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
