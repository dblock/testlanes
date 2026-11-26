import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Framework
 * @property {string} name
 * @property {string} reporter Absolute path of the testlanes timing reporter.
 * @property {((testArgs: string[]) => string[]) | null} listArgs Listing arguments, or null when files come from default patterns.
 * @property {(stdout: string) => string[]} parseList
 * @property {(files: string[], testArgs: string[]) => string[]} runArgs
 * @property {(cwd: string) => string[]} command Executable and leading arguments.
 * @property {(env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv} [environment] Adjusts the runner's environment.
 */

/**
 * Glob patterns matching the files `node --test` runs by default, including
 * TypeScript when the running Node.js can strip types.
 *
 * @returns {string[]}
 */
export function nodeTestPatterns() {
  const extensions = process.features.typescript ? "{cjs,mjs,js,cts,mts,ts}" : "{cjs,mjs,js}";
  return ["**/*.test", "**/*-test", "**/*_test", "**/test-*", "**/test", "**/test/**/*"].map((pattern) => `${pattern}.${extensions}`);
}

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
    command: (cwd) => [process.execPath, packageBin("vitest", cwd)],
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
    command: (cwd) => [process.execPath, packageBin("jest", cwd)],
  },
  node: {
    name: "node",
    reporter: join(reporters, "node.js"),
    // node --test cannot list files, so discovery globs its default patterns.
    listArgs: null,
    parseList: () => [],
    // The testlanes reporter writes its own file, so its destination stream stays empty.
    runArgs: (files, testArgs) => [
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${join(reporters, "node.js")}`,
      "--test-reporter-destination=stderr",
      ...testArgs,
      ...files,
    ],
    command: () => [process.execPath],
    // A nested node --test skips its files when it inherits the parent's test context.
    environment: (env) => {
      const copy = { ...env };
      delete copy.NODE_TEST_CONTEXT;
      return copy;
    },
  },
};

/**
 * Returns a supported framework.
 *
 * @param {unknown} name
 * @returns {Framework}
 */
export function framework(name) {
  if (name !== "vitest" && name !== "jest" && name !== "node") {
    throw new Error(`Unsupported test framework ${JSON.stringify(name)}; expected vitest, jest, or node.`);
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
  const [executable, ...leading] = selected.command(cwd);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...leading, ...args], {
      cwd,
      env: selected.environment ? selected.environment(env) : env,
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
