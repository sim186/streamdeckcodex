import type {
  AgentSnapshot,
  AgentStatus,
  ContextSnapshot,
  LimitSnapshot,
  SessionSnapshot,
} from "../../types.js";
import { readFileTail } from "../file-tail.js";
import { budgetsFromEnv, estimateClaudeCodeLimits } from "./limits.js";
import {
  claudeCodeProjectsDir,
  contextTokensOf,
  listTranscripts,
  parseTranscriptEvents,
  sessionTitleOf,
  type TranscriptEvent,
} from "./transcripts.js";

/**
 * Claude Code's default context window. Used only to express context as a
 * percentage; the token figure it derives from is read from the transcript.
 */
const DEFAULT_CONTEXT_TOKENS = 200_000;

/** A session whose transcript stopped growing this recently is still working. */
const ACTIVE_WINDOW_MS = 45_000;

interface LoadedSession {
  snapshot: AgentSnapshot;
  events: TranscriptEvent[];
}

function statusOf(
  events: TranscriptEvent[],
  modifiedAt: number,
  acknowledgedAt: number | undefined,
  now: number,
): AgentStatus {
  const last = events[events.length - 1];
  if (last === undefined) return "idle";
  const recentlyActive = now - modifiedAt < ACTIVE_WINDOW_MS;

  // Without hooks the transcript is the only signal, and it cannot distinguish
  // "waiting for the user" from "finished". A turn that ended on a tool call,
  // or a user turn with no reply yet, is treated as still running only while
  // the file is fresh; otherwise the session is simply idle.
  if (recentlyActive && (last.toolUse || last.role === "user"))
    return "running";
  if (last.stopped && acknowledgedAt !== undefined) {
    const completedAt = last.timestamp ?? modifiedAt;
    if (completedAt > acknowledgedAt) return "unread";
    return "idle";
  }
  if (last.stopped && acknowledgedAt === undefined) return "unread";
  return "idle";
}

/**
 * Reads Claude Code sessions from local transcripts.
 *
 * Everything is derived from files the CLI happens to write, so each read is
 * defensive and a missing or renamed field costs a field, not the snapshot.
 */
export class ClaudeCodeStore {
  readonly #acknowledged = new Map<string, number>();
  #cache: { at: number; sessions: LoadedSession[] } | undefined;
  #projectsDir: string;
  #now: () => number;

  constructor(
    projectsDir = claudeCodeProjectsDir(),
    now: () => number = Date.now,
  ) {
    this.#projectsDir = projectsDir;
    this.#now = now;
  }

  acknowledge(sessionId: string, at = this.#now()): void {
    this.#acknowledged.set(sessionId, at);
    this.#cache = undefined;
  }

  invalidate(): void {
    this.#cache = undefined;
  }

  close(): void {
    this.#cache = undefined;
    this.#acknowledged.clear();
  }

  #load(): LoadedSession[] {
    const now = this.#now();
    if (this.#cache && now - this.#cache.at < 2_000)
      return this.#cache.sessions;

    const sessions = listTranscripts(this.#projectsDir).map((file) => {
      const events = parseTranscriptEvents(readFileTail(file.path));
      const title = sessionTitleOf(events) ?? file.sessionId.slice(0, 8);
      const cwd = events.find((event) => event.cwd)?.cwd ?? "";
      const status = statusOf(
        events,
        file.modifiedAt,
        this.#acknowledged.get(file.sessionId),
        now,
      );
      const snapshot: AgentSnapshot = {
        id: file.sessionId,
        rolloutPath: file.path,
        cwd,
        title,
        preview: title,
        recencyAtMs: file.modifiedAt,
        displayTitle: title,
        status,
        lastEventAt: file.modifiedAt,
      };
      return { snapshot, events };
    });

    this.#cache = { at: now, sessions };
    return sessions;
  }

  sessions(limit = 8): SessionSnapshot[] {
    return this.#load()
      .slice(0, limit)
      .map(({ snapshot }, index) => ({
        ...snapshot,
        sessionLabel: snapshot.displayTitle,
        sessionIndex: index,
        isActive: index === 0,
      }));
  }

  latestSession(): AgentSnapshot | undefined {
    return this.#load()[0]?.snapshot;
  }

  /**
   * The most recently written transcript. Claude Code runs in a terminal the
   * companion cannot inspect, so "focused" means "most recently active" — a
   * weaker claim than the Codex provider's, and deliberately so.
   */
  focusedSession(): AgentSnapshot | undefined {
    return this.latestSession();
  }

  contextSnapshot(): ContextSnapshot | undefined {
    const session = this.#load()[0];
    if (session === undefined) return undefined;
    const usedTokens = contextTokensOf(session.events);
    if (usedTokens === undefined) return undefined;
    const maxTokens = DEFAULT_CONTEXT_TOKENS;
    return {
      threadId: session.snapshot.id,
      usedTokens,
      maxTokens,
      remainingPercent: Math.max(
        0,
        Math.min(100, 100 - (usedTokens / maxTokens) * 100),
      ),
      observedAt: session.snapshot.lastEventAt,
    };
  }

  limitsSnapshot(): LimitSnapshot | undefined {
    const events = this.#load().flatMap(({ events: session }) => session);
    return estimateClaudeCodeLimits(events, budgetsFromEnv(), this.#now());
  }
}

export const claudeCodeStore = new ClaudeCodeStore();
