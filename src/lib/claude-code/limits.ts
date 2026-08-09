import type { LimitSnapshot, LimitWindow } from "../../types.js";
import { buildWindow } from "../limits.js";
import type { TranscriptEvent } from "./transcripts.js";

export const CLAUDE_CODE_AGENT_ID = "claude-code";

const FIVE_HOURS_MINUTES = 300;
const WEEK_MINUTES = 10_080;

/**
 * Anthropic publishes no programmatic read of Claude Code account limits — the
 * figures behind `/usage` are not exposed to other processes. Everything here
 * is therefore reconstructed from local transcripts and reported as
 * `estimated`, never as a vendor-confirmed number.
 *
 * Token caps are not published either, so a window carries no `limit` unless
 * the operator supplies one. Without a cap the key shows tokens consumed
 * rather than inventing a percentage of an allowance nobody has published.
 */
export interface ClaudeCodeBudgets {
  fiveHourTokens?: number;
  weeklyTokens?: number;
}

export function budgetsFromEnv(env = process.env): ClaudeCodeBudgets {
  const read = (key: string): number | undefined => {
    const raw = env[key];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const fiveHour = read("STREAMDECK_CLAUDE_5H_TOKEN_BUDGET");
  const weekly = read("STREAMDECK_CLAUDE_WEEKLY_TOKEN_BUDGET");
  return {
    ...(fiveHour === undefined ? {} : { fiveHourTokens: fiveHour }),
    ...(weekly === undefined ? {} : { weeklyTokens: weekly }),
  };
}

function tokensOf(event: TranscriptEvent): number {
  const usage = event.usage;
  if (usage === undefined) return 0;
  // Cache reads are excluded: they are billed and rate-limited differently
  // from fresh input, and counting them would overstate a long session by an
  // order of magnitude.
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens;
}

function windowFrom(
  events: TranscriptEvent[],
  minutes: number,
  now: number,
  limit: number | undefined,
): LimitWindow | undefined {
  const startedAfter = now - minutes * 60_000;
  const inWindow = events.filter(
    (event) => event.timestamp !== undefined && event.timestamp >= startedAfter,
  );
  if (inWindow.length === 0) return undefined;

  const used = inWindow.reduce((total, event) => total + tokensOf(event), 0);
  // Anthropic describes each window as opening with the first message in it,
  // so the earliest activity still inside the window dates the reset.
  const openedAt = Math.min(
    ...inWindow.map((event) => event.timestamp ?? Number.POSITIVE_INFINITY),
  );
  return buildWindow({
    minutes,
    used,
    unit: "tokens",
    fidelity: "estimated",
    resetsAt: Math.round((openedAt + minutes * 60_000) / 1000),
    ...(limit === undefined ? {} : { limit }),
  });
}

export function estimateClaudeCodeLimits(
  events: TranscriptEvent[],
  budgets: ClaudeCodeBudgets = {},
  now = Date.now(),
): LimitSnapshot | undefined {
  const windows = [
    windowFrom(events, FIVE_HOURS_MINUTES, now, budgets.fiveHourTokens),
    windowFrom(events, WEEK_MINUTES, now, budgets.weeklyTokens),
  ].filter((window): window is LimitWindow => window !== undefined);
  if (windows.length === 0) return undefined;
  return { agent: CLAUDE_CODE_AGENT_ID, windows, observedAt: now };
}
