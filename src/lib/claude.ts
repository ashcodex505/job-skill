import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Local Claude Code CLI bridge. Used for the career-ops-style features that
 * benefit from language understanding (e.g. "edit my preferences in plain
 * words"). Everything runs on your machine via `claude -p`; nothing in the
 * scraper or credential paths depends on it — if the CLI isn't installed,
 * those features degrade to manual file editing.
 */

// GUI-launched servers (the Mac .app) miss Homebrew/npm paths.
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", `${os.homedir()}/.local/bin`, `${os.homedir()}/.npm-global/bin`]
  .filter(Boolean)
  .join(":");

let cachedAvailable: boolean | null = null;

export async function claudeAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    await execFileAsync("claude", ["--version"], { env: { ...process.env, PATH }, timeout: 10_000 });
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

export class ClaudeUnavailableError extends Error {
  constructor() {
    super("Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) to use plain-English editing, or edit career/*.md by hand.");
    this.name = "ClaudeUnavailableError";
  }
}

/** Run a one-shot prompt through the local Claude Code CLI and return stdout. */
export async function runClaude(prompt: string, timeoutMs = 180_000): Promise<string> {
  if (!(await claudeAvailable())) throw new ClaudeUnavailableError();
  const { stdout } = await execFileAsync("claude", ["-p", prompt, "--output-format", "text"], {
    env: { ...process.env, PATH },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    cwd: os.tmpdir(), // keep the one-shot session away from project files; all context is in the prompt
  });
  return stdout.trim();
}
