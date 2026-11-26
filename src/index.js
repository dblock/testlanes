import { readFileSync } from "node:fs";

/**
 * The installed testlanes version, read from the package manifest.
 *
 * @type {string}
 */
export const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
