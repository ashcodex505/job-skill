import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Minimal GitHub API bridge for the local app, authenticated with the same
 * stored credential git already uses for this repo (via `git credential
 * fill` — never logged, never persisted by us). Used to keep the CI watch
 * workflow's enabled-state in sync with the watchlist:
 *
 *   watches exist  → enable watch.yml + dispatch an immediate run
 *   watchlist empty → disable watch.yml (no hourly runs at all)
 *
 * Everything here is best-effort: failures return a human message for the
 * dashboard banner, and the job-board workflow re-syncs the state twice a
 * day as a backstop.
 */

/** `git credential fill` needs stdin; wrap execFile manually. */
function credentialFill(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["credential", "fill"],
      { cwd: process.cwd(), timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    child.stdin?.write("protocol=https\nhost=github.com\n\n");
    child.stdin?.end();
  });
}

async function auth(): Promise<{ token: string; repo: string }> {
  const { stdout: url } = await execFileAsync("git", ["remote", "get-url", "origin"], {
    cwd: process.cwd(),
    timeout: 5000,
  });
  const match = url.trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error("origin is not a GitHub remote");
  const fill = await credentialFill();
  const token = fill.match(/^password=(.+)$/m)?.[1];
  if (!token) throw new Error("no stored GitHub credential");
  return { token, repo: match[1] };
}

async function apiCall(token: string, method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "resume-tracker-local",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`GitHub API ${method} ${path} → ${res.status}`);
  }
}

/**
 * Keep watch.yml enabled and kick an immediate scan when a watch is added.
 * The hourly workflow is never disabled anymore — even with an empty
 * watchlist it powers the big-tech/unicorn alert stream.
 */
export async function syncWatchWorkflow(hasWatches: boolean): Promise<string | null> {
  try {
    const { token, repo } = await auth();
    const wf = `/repos/${repo}/actions/workflows/watch.yml`;
    await apiCall(token, "PUT", `${wf}/enable`);
    if (hasWatches) await apiCall(token, "POST", `${wf}/dispatches`, { ref: "main" });
    return null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `CI watch workflow state couldn't be updated (${detail}) — it self-corrects on the next job-board run.`;
  }
}
