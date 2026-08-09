import { describe, expect, it } from "vitest";
import type { LimitSnapshot } from "../src/types.js";
import {
  buildWindow,
  canonicalWindowId,
  formatBalance,
  formatWindowValue,
  isEstimated,
  longestWindow,
  remainingPercentOf,
  selectWindow,
  usedPercentOf,
  windowLabel,
} from "../src/lib/limits.js";
import {
  limitsFromRateLimitsResult,
  parseLatestLimits,
} from "../src/lib/usage.js";

describe("limit window identity", () => {
  it("gives vendors with matching durations the same window id", () => {
    expect(canonicalWindowId(300)).toBe("5h");
    expect(canonicalWindowId(10_080)).toBe("weekly");
    expect(canonicalWindowId(43_200)).toBe("monthly");
  });

  it("derives a readable id for durations no vendor has published yet", () => {
    expect(canonicalWindowId(30)).toBe("30m");
    expect(canonicalWindowId(720)).toBe("12h");
    expect(canonicalWindowId(4_320)).toBe("3d");
    expect(windowLabel("12h")).toBe("12H");
    expect(windowLabel("weekly")).toBe("WEEKLY");
  });
});

describe("unit-independent consumption", () => {
  it("treats a percent window as already normalized", () => {
    const window = buildWindow({
      minutes: 10_080,
      used: 73,
      unit: "percent",
      fidelity: "exact",
    });
    expect(usedPercentOf(window)).toBe(73);
    expect(remainingPercentOf(window)).toBe(27);
    expect(formatWindowValue(window)).toBe("73%");
  });

  it("derives a percentage for a dollar-metered window", () => {
    const window = buildWindow({
      minutes: 300,
      used: 8.4,
      limit: 12,
      unit: "usd",
      fidelity: "exact",
    });
    expect(usedPercentOf(window)).toBe(70);
    expect(formatWindowValue(window)).toBe("$8.40/$12");
  });

  it("reports no percentage when the vendor publishes usage without a cap", () => {
    const window = buildWindow({
      id: "session",
      used: 128_000,
      unit: "tokens",
      fidelity: "exact",
    });
    expect(usedPercentOf(window)).toBe(undefined);
    expect(remainingPercentOf(window)).toBe(undefined);
    expect(formatWindowValue(window)).toBe("128K");
  });

  it("clamps a window the vendor reports as overdrawn", () => {
    const window = buildWindow({
      minutes: 300,
      used: 15,
      limit: 12,
      unit: "usd",
      fidelity: "exact",
    });
    expect(usedPercentOf(window)).toBe(100);
    expect(remainingPercentOf(window)).toBe(0);
  });
});

describe("Codex account limits", () => {
  const result = {
    rateLimits: {
      primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 100 },
      secondary: { usedPercent: 52, windowDurationMins: 10_080, resetsAt: 200 },
    },
    rateLimitResetCredits: { availableCount: 2 },
  };

  it("keeps both windows instead of collapsing to the longest", () => {
    const snapshot = limitsFromRateLimitsResult(result, 50);
    expect(snapshot?.windows.map((window) => window.id)).toEqual([
      "5h",
      "weekly",
    ]);
    expect(selectWindow(snapshot, "5h")?.used).toBe(80);
    expect(selectWindow(snapshot, "weekly")?.resetsAt).toBe(200);
  });

  it("models banked resets as a credit balance beside the windows", () => {
    const snapshot = limitsFromRateLimitsResult(result, 50);
    expect(snapshot?.balance).toEqual({
      amount: 2,
      unit: "credits",
      label: "RESETS",
    });
    expect(formatBalance(snapshot!.balance!)).toBe("2");
  });

  it("marks vendor-published windows exact", () => {
    expect(isEstimated(limitsFromRateLimitsResult(result, 50))).toBe(false);
  });

  it("skips windows the vendor sent without a percentage", () => {
    const snapshot = limitsFromRateLimitsResult({
      rateLimits: {
        primary: { usedPercent: 41, windowDurationMins: 300 },
        secondary: { windowDurationMins: 10_080, resetsAt: 200 },
      },
    });
    expect(snapshot?.windows.map((window) => window.id)).toEqual(["5h"]);
  });

  it("returns nothing when no window carries a percentage", () => {
    expect(limitsFromRateLimitsResult({ rateLimits: {} })).toBe(undefined);
  });
});

describe("Codex rollout fallback", () => {
  it("reads both windows from the newest token_count event", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2026-07-25T16:00:00Z",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 10, window_minutes: 300 },
            secondary: { used_percent: 20, window_minutes: 10_080 },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-25T17:00:00Z",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 63, window_minutes: 300, resets_at: 900 },
            secondary: {
              used_percent: 42,
              window_minutes: 10_080,
              resets_at: 1785259094,
            },
          },
        },
      }),
    ].join("\n");

    const snapshot = parseLatestLimits(lines);
    expect(snapshot?.agent).toBe("codex");
    expect(snapshot?.observedAt).toBe(Date.parse("2026-07-25T17:00:00Z"));
    expect(selectWindow(snapshot, "5h")).toMatchObject({
      used: 63,
      resetsAt: 900,
      fidelity: "exact",
    });
    expect(selectWindow(snapshot, "weekly")?.used).toBe(42);
  });

  it("ignores malformed and incomplete events", () => {
    expect(
      parseLatestLimits('not json\n{"payload":{"type":"token_count"}}'),
    ).toBe(undefined);
  });
});

describe("multi-vendor snapshots", () => {
  /** OpenCode Go: dollar windows plus a Zen balance that absorbs overflow. */
  const openCodeGo: LimitSnapshot = {
    agent: "opencode",
    account: "OpenCode Go",
    observedAt: 0,
    windows: [
      buildWindow({
        minutes: 300,
        used: 8.4,
        limit: 12,
        unit: "usd",
        fidelity: "exact",
      }),
      buildWindow({
        minutes: 10_080,
        used: 30,
        limit: 30,
        unit: "usd",
        fidelity: "exact",
      }),
      buildWindow({
        minutes: 43_200,
        used: 41.5,
        limit: 60,
        unit: "usd",
        fidelity: "exact",
      }),
    ],
    balance: { amount: 14.25, unit: "usd", label: "ZEN" },
  };

  it("carries three windows and a balance at once", () => {
    expect(openCodeGo.windows).toHaveLength(3);
    expect(longestWindow(openCodeGo)?.id).toBe("monthly");
    expect(formatWindowValue(selectWindow(openCodeGo, "monthly")!)).toBe(
      "$41.50/$60",
    );
    expect(formatBalance(openCodeGo.balance!)).toBe("$14.25");
  });

  it("still exposes an exhausted window as fully consumed", () => {
    expect(remainingPercentOf(selectWindow(openCodeGo, "weekly")!)).toBe(0);
  });

  /** Claude Code publishes no account limits, so windows are inferred. */
  it("flags an inferred snapshot so it is never shown as vendor-confirmed", () => {
    const claudeCode: LimitSnapshot = {
      agent: "claude-code",
      account: "Claude Max",
      observedAt: 0,
      windows: [
        buildWindow({
          minutes: 300,
          used: 55,
          unit: "percent",
          fidelity: "estimated",
        }),
      ],
    };
    expect(isEstimated(claudeCode)).toBe(true);
    expect(isEstimated(openCodeGo)).toBe(false);
  });

  it("ranks the broadest window even when vendors expose different sets", () => {
    expect(
      longestWindow({
        agent: "codex",
        observedAt: 0,
        windows: [
          buildWindow({
            minutes: 300,
            used: 1,
            unit: "percent",
            fidelity: "exact",
          }),
          buildWindow({
            minutes: 10_080,
            used: 2,
            unit: "percent",
            fidelity: "exact",
          }),
        ],
      })?.id,
    ).toBe("weekly");
  });
});
