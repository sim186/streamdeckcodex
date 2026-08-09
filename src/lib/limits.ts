import type { LimitBalance, LimitSnapshot, LimitWindow } from "../types.js";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_MONTH = 43_200;

const CANONICAL_WINDOW_IDS: ReadonlyMap<number, string> = new Map([
  [300, "5h"],
  [10_080, "weekly"],
  [MINUTES_PER_MONTH, "monthly"],
]);

const CANONICAL_WINDOW_LABELS: Readonly<Record<string, string>> = {
  "5h": "5H",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

/**
 * Names a window by its duration so windows from different vendors line up.
 * Codex reports 300 and 10080 minutes; OpenCode Go publishes 5-hour, weekly,
 * and monthly caps. Both land on the same ids.
 */
export function canonicalWindowId(minutes: number): string {
  const known = CANONICAL_WINDOW_IDS.get(minutes);
  if (known) return known;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < MINUTES_PER_DAY) return `${Math.round(minutes / 60)}h`;
  if (minutes < MINUTES_PER_MONTH)
    return `${Math.round(minutes / MINUTES_PER_DAY)}d`;
  return `${Math.round(minutes / MINUTES_PER_MONTH)}mo`;
}

export function windowLabel(id: string): string {
  return CANONICAL_WINDOW_LABELS[id] ?? id.toUpperCase();
}

/**
 * Consumption as a percentage, derived rather than stored so dollar- and
 * token-metered vendors share the bar rendering. Undefined when the vendor
 * reports usage without a cap — the caller must show the raw value instead.
 */
export function usedPercentOf(window: LimitWindow): number | undefined {
  if (window.unit === "percent") return clampPercent(window.used);
  if (window.limit === undefined || window.limit <= 0) return undefined;
  return clampPercent((window.used / window.limit) * 100);
}

export function remainingPercentOf(window: LimitWindow): number | undefined {
  const used = usedPercentOf(window);
  return used === undefined ? undefined : clampPercent(100 - used);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

/**
 * Renders a window the way its vendor meters it: `73%` for Codex, `$8.40/$12`
 * for OpenCode Go. Keeps the unit visible so two providers on one profile are
 * never mistaken for each other.
 */
export function formatWindowValue(window: LimitWindow): string {
  if (window.unit === "percent") return `${Math.round(window.used)}%`;
  const format = window.unit === "usd" ? formatUsd : formatTokens;
  const used = format(window.used);
  return window.limit === undefined ? used : `${used}/${format(window.limit)}`;
}

export function formatBalance(balance: LimitBalance): string {
  return balance.unit === "usd"
    ? formatUsd(balance.amount)
    : String(balance.amount);
}

export function selectWindow(
  snapshot: LimitSnapshot | undefined,
  id: string,
): LimitWindow | undefined {
  return snapshot?.windows.find((window) => window.id === id);
}

/**
 * The broadest window a snapshot carries. Used where a single headline number
 * is all that fits; prefer {@link selectWindow} when the caller knows which
 * window it wants.
 */
export function longestWindow(
  snapshot: LimitSnapshot | undefined,
): LimitWindow | undefined {
  return snapshot?.windows.reduce<LimitWindow | undefined>(
    (widest, window) =>
      widest === undefined || windowRank(window) > windowRank(widest)
        ? window
        : widest,
    undefined,
  );
}

function windowRank(window: LimitWindow): number {
  const index = ["5h", "weekly", "monthly"].indexOf(window.id);
  return index >= 0 ? index : -1;
}

export function isEstimated(snapshot: LimitSnapshot | undefined): boolean {
  return snapshot?.windows.some((window) => window.fidelity === "estimated")
    ? true
    : false;
}

export function buildWindow(input: {
  minutes?: number;
  id?: string;
  used: number;
  limit?: number;
  unit: LimitWindow["unit"];
  resetsAt?: number;
  fidelity: LimitWindow["fidelity"];
}): LimitWindow {
  const id =
    input.id ??
    (input.minutes === undefined ? "window" : canonicalWindowId(input.minutes));
  return {
    id,
    label: windowLabel(id),
    used: input.used,
    unit: input.unit,
    fidelity: input.fidelity,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.resetsAt === undefined ? {} : { resetsAt: input.resetsAt }),
  };
}
