import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Framework
 * @property {string} name
 * @property {string} reporter Absolute path of the testlanes timing reporter.
 * @property {(testArgs: string[]) => string[]} listArgs
 * @property {(stdout: string) => string[]} parseList
 * @property {(files: string[], testArgs: string[]) => string[]} runArgs
 */

const reporters = fileURLToPath(new URL("./reporters/", import.meta.url));

/** @type {Record<string, Framework>} */
export const frameworks = {
  vitest: {
    name: "vitest",
    reporter: join(reporters, "vitest.js"),
    listArgs: (testArgs) => ["list", "--filesOnly", "--json", ...testArgs],
    parseList: (stdout) => parseListing(stdout, "vitest").map((entry) => {
      const file = entry !== null && typeof entry === "object" ? /** @type {{ file?: unknown }} */ (entry).file : undefined;
      if (typeof file !== "string") throw new Error("vitest list returned an unexpected entry.");
      return file;
    }),
    // Vitest ignores file filters after `--`, so files come first, before any options.
    runArgs: (files, testArgs) => ["run", ...files, "--reporter=default", `--reporter=${join(reporters, "vitest.js")}`, ...testArgs],
  },
  jest: {
    name: "jest",
    reporter: join(reporters, "jest.js"),
    listArgs: (testArgs) => ["--listTests", "--json", ...testArgs],
    parseList: (stdout) => parseListing(stdout, "jest").map((entry) => {
      if (typeof entry !== "string") throw new Error("jest --listTests returned an unexpected entry.");
      return entry;
    }),
    // `--reporters` accepts several values, so files follow `--` to keep them positional.
    runArgs: (files, testArgs) => ["--reporters=default", `--reporters=${join(reporters, "jest.js")}`, ...testArgs, "--runTestsByPath", "--", ...files],
  },
};

/**
 * Returns a supported framework.
 *
 * @param {unknown} name
 * @returns {Framework}
 */
export function framework(name) {
  if (name !== "vitest" && name !== "jest") {
    throw new Error(`Unsupported test framework ${JSON.stringify(name)}; expected vitest or jest.`);
  }
  return frameworks[name];
}

/**
 * @param {string} stdout
 * @param {string} name
 * @returns {unknown[]}
 */
function parseListing(stdout, name) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse the ${name} test listing as JSON.`);
  }
  if (!Array.isArray(data)) throw new Error(`The ${name} test listing is not a JSON array.`);
  return data;
}

/**
 * Finds the executable script of a package installed in or above a directory.
 *
 * @param {string} name
 * @param {string} cwd
 * @returns {string}
 */
export function packageBin(name, cwd) {
  let directory = resolve(cwd);
  for (;;) {
    const manifest = join(directory, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
      const script = typeof bin === "string" ? bin : bin?.[name];
      if (typeof script !== "string") throw new Error(`${name} does not declare a ${name} executable.`);
      return join(dirname(manifest), script);
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`${name} is not installed in ${cwd} or its parent directories.`);
    directory = parent;
  }
}

/**
 * Runs a framework's executable with Node.js.
 *
 * @param {Framework} selected
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, capture?: boolean }} options
 * @returns {Promise<{ code: number, stdout: string }>}
 */
export function execute(selected, args, { cwd, env = process.env, capture = false }) {
  const bin = packageBin(selected.name, cwd);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolvePromise({ code: code ?? 128 + (signal === "SIGKILL" ? 9 : 15), stdout });
    });
  });
}
