import { execFile, spawnSync } from "node:child_process";
import { cp, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const bin = join(root, "bin", "testlanes.js");

/**
 * Copies a fixture project into a temporary directory that resolves the
 * repository's installed Vitest and Jest through a node_modules symlink.
 *
 * @param {"vitest" | "jest" | "node"} name
 * @returns {Promise<string>}
 */
export async function project(name) {
  const directory = await mkdtemp(join(tmpdir(), `testlanes-${name}-`));
  await cp(join(root, "fixtures", name, "specs"), join(directory, "specs"), { recursive: true });
  await cp(join(root, "fixtures", name, "package.json"), join(directory, "package.json"));
  // Windows creates directory junctions without extra privileges.
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return directory;
}

/**
 * Runs the testlanes CLI as a subprocess.
 *
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options
 */
export function cli(args, { cwd, env = {} }) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "", ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs the testlanes CLI as a subprocess without blocking the event loop, for
 * tests that serve HTTP requests from the same process.
 *
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function cliAsync(args, { cwd, env = {} }) {
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [bin, ...args], { cwd, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", ...env } }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") reject(error);
      else resolvePromise({ code: error ? /** @type {number} */ (error.code) : 0, stdout, stderr });
    });
  });
}
