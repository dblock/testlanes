import { appendFile } from "node:fs/promises";

/**
 * Validates an artifact name prefix.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function artifactPrefix(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Artifact prefix must contain only letters, numbers, underscores, and hyphens.");
  }
  return value;
}

/**
 * Appends step outputs to `$GITHUB_OUTPUT`.
 *
 * @param {Record<string, string | number>} values
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
export async function writeOutputs(values, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const text = String(value);
    if (/[\r\n]/u.test(text)) throw new Error(`Output ${key} must be a single line.`);
    return `${key}=${text}\n`;
  });
  await appendFile(env.GITHUB_OUTPUT, lines.join(""));
}

/**
 * Returns a required environment variable.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @returns {string}
 */
export function requiredEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
