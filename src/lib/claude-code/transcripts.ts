import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code's transcript layout is not a published API: it is a directory of
 * newline-delimited JSON under the CLI's config home, one file per session.
 * Every field is therefore treated as optional and every record is parsed
 * defensively, so a schema change degrades a key to "no data" instead of
 * throwing inside a render.
 */

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface TranscriptEvent {
  role?: string;
  timestamp?: number;
  cwd?: string;
  sessionId?: string;
  summary?: string;
  text?: string;
  usage?: TranscriptUsage;
  stopped: boolean;
  toolUse: boolean;
}

export interface TranscriptFile {
  sessionId: string;
  path: string;
  modifiedAt: number;
}

export function claudeCodeHome(env = process.env): string {
  return env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
}

export function claudeCodeProjectsDir(env = process.env): string {
  return join(claudeCodeHome(env), "projects");
}

/**
 * Lists session transcripts newest first. Returns nothing when Claude Code has
 * never run on this machine, which is a supported state rather than an error.
 */
export function listTranscripts(
  projectsDir = claudeCodeProjectsDir(),
  limit = 24,
): TranscriptFile[] {
  if (!existsSync(projectsDir)) return [];
  const files: TranscriptFile[] = [];
  let projects: string[];
  try {
    projects = readdirSync(projectsDir);
  } catch {
    return [];
  }
  for (const project of projects) {
    const dir = join(projectsDir, project);
    let entries: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const path = join(dir, entry);
      try {
        files.push({
          sessionId: entry.slice(0, -".jsonl".length),
          path,
          modifiedAt: statSync(path).mtimeMs,
        });
      } catch {
        // A transcript removed between listing and stat is simply skipped.
      }
    }
  }
  return files
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, limit);
}

function readUsage(value: unknown): TranscriptUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  const read = (key: string): number => {
    const raw = usage[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };
  const parsed: TranscriptUsage = {
    inputTokens: read("input_tokens"),
    outputTokens: read("output_tokens"),
    cacheReadTokens: read("cache_read_input_tokens"),
    cacheCreationTokens: read("cache_creation_input_tokens"),
  };
  return parsed.inputTokens +
    parsed.outputTokens +
    parsed.cacheReadTokens +
    parsed.cacheCreationTokens >
    0
    ? parsed
    : undefined;
}

function readText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = ((block as { text: string }).text ?? "").trim();
      if (text) return text;
    }
  }
  return undefined;
}

function hasToolUse(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_use",
    )
  );
}

export function parseTranscriptEvents(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = (
      typeof record["message"] === "object" && record["message"] !== null
        ? record["message"]
        : {}
    ) as Record<string, unknown>;
    const timestamp = Date.parse(String(record["timestamp"] ?? ""));
    const role =
      typeof message["role"] === "string"
        ? message["role"]
        : typeof record["type"] === "string"
          ? record["type"]
          : undefined;
    const usage = readUsage(message["usage"]);
    const text = readText(message["content"]);
    const summary =
      typeof record["summary"] === "string" ? record["summary"] : undefined;

    events.push({
      stopped:
        typeof message["stop_reason"] === "string" &&
        message["stop_reason"] !== "tool_use",
      toolUse: hasToolUse(message["content"]),
      ...(role === undefined ? {} : { role }),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      ...(typeof record["cwd"] === "string" ? { cwd: record["cwd"] } : {}),
      ...(typeof record["sessionId"] === "string"
        ? { sessionId: record["sessionId"] }
        : {}),
      ...(summary === undefined ? {} : { summary }),
      ...(text === undefined ? {} : { text }),
      ...(usage === undefined ? {} : { usage }),
    });
  }
  return events;
}

/**
 * The context a session currently occupies. Claude Code re-sends the whole
 * conversation each turn, so the newest assistant turn's input plus cache
 * tokens is the live context size — output tokens are excluded because they
 * are already counted in the next turn's input.
 */
export function contextTokensOf(events: TranscriptEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const usage = events[index]!.usage;
    if (usage === undefined) continue;
    return (
      usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
    );
  }
  return undefined;
}

export function sessionTitleOf(events: TranscriptEvent[]): string | undefined {
  for (const event of events) {
    if (event.summary) return event.summary;
  }
  for (const event of events) {
    if (event.role === "user" && event.text) return event.text;
  }
  return undefined;
}
