import { appendFile, readFile } from "node:fs/promises";

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
 * Finds the newest trusted timing baseline: an unexpired `<prefix>-timings`
 * artifact from one of the latest 20 successful default-branch push runs of
 * the current workflow in the same repository.
 *
 * @param {object} options
 * @param {string} options.prefix
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{ run: number, artifact: number } | undefined>}
 */
export async function findHistory({ prefix, env = process.env }) {
  const name = `${artifactPrefix(prefix)}-timings`;
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const event = JSON.parse(await readFile(requiredEnv(env, "GITHUB_EVENT_PATH"), "utf8"));
  const branch = event?.repository?.default_branch;
  if (typeof branch !== "string") throw new Error("The event payload does not name the default branch.");
  const base = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  /** @param {string} path */
  const api = async (path) => {
    const response = await fetch(`${base}/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requiredEnv(env, "GITHUB_TOKEN")}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub API request for ${path} failed with status ${response.status}.`);
    return response.json();
  };
  const current = await api(`repos/${repository}/actions/runs/${requiredEnv(env, "GITHUB_RUN_ID")}`);
  const query = new URLSearchParams({ branch, event: "push", status: "success", per_page: "20" });
  const { workflow_runs: runs } = await api(`repos/${repository}/actions/workflows/${current.workflow_id}/runs?${query}`);
  for (const run of runs) {
    if (run.event !== "push" || run.conclusion !== "success" || run.head_branch !== branch || run.head_repository?.full_name !== repository) continue;
    const { artifacts } = await api(`repos/${repository}/actions/runs/${run.id}/artifacts?${new URLSearchParams({ name, per_page: "100" })}`);
    const artifact = artifacts.find((/** @type {{ name: string, expired: boolean }} */ entry) => entry.name === name && !entry.expired);
    if (artifact) return { run: run.id, artifact: artifact.id };
  }
  return undefined;
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
