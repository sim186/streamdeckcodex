import { describe, expect, it } from "vitest";
import type { LimitSnapshot } from "../src/types.js";
import { buildWindow, nextLimitView } from "../src/lib/limits.js";
import { limitKeySvg } from "../src/lib/visuals.js";

const codex: LimitSnapshot = {
  agent: "codex",
  observedAt: Date.parse("2026-07-25T17:00:00Z"),
  windows: [
    buildWindow({
      minutes: 300,
      used: 12,
      unit: "percent",
      fidelity: "exact",
      resetsAt: Date.parse("2026-07-25T22:00:00Z") / 1000,
    }),
    buildWindow({
      minutes: 10_080,
      used: 42,
      unit: "percent",
      fidelity: "exact",
      resetsAt: Date.parse("2026-07-28T17:00:00Z") / 1000,
    }),
  ],
  balance: { amount: 3, unit: "credits", label: "RESETS" },
};

const now = Date.parse("2026-07-25T17:00:00Z");

describe("limit key rendering", () => {
  it("renders remaining capacity and days to reset for the weekly window", () => {
    const svg = limitKeySvg(codex, "weekly", now);
    expect(svg).toContain(">WEEKLY LEFT</text>");
    expect(svg).toContain(">58%</text>");
    expect(svg).toContain(">RESET 3D</text>");
    expect(svg).toContain("#35C759");
  });

  it("renders the 5-hour window the old key could never reach", () => {
    const svg = limitKeySvg(codex, "5h", now);
    expect(svg).toContain(">5H LEFT</text>");
    expect(svg).toContain(">88%</text>");
    expect(svg).toContain(">RESET 5H</text>");
  });

  it("renders the balance view with its vendor label", () => {
    const svg = limitKeySvg(codex, "balance", now);
    expect(svg).toContain(">RESETS</text>");
    expect(svg).toContain(">3</text>");
    expect(svg).toContain(">AVAILABLE</text>");
  });

  it("shows no data when the snapshot is missing", () => {
    const svg = limitKeySvg(undefined, "weekly", now);
    expect(svg).toContain(">NO DATA</text>");
    expect(svg).toContain("#6C7480");
  });

  it("warns in colour as a window approaches exhaustion", () => {
    const nearly = {
      ...codex,
      windows: [
        buildWindow({
          minutes: 10_080,
          used: 95,
          unit: "percent",
          fidelity: "exact",
        }),
      ],
    };
    expect(limitKeySvg(nearly, "weekly", now)).toContain("#F85149");
  });

  it("marks an inferred window so it cannot pass as vendor-published", () => {
    const claudeCode: LimitSnapshot = {
      agent: "claude-code",
      observedAt: now,
      windows: [
        buildWindow({
          minutes: 300,
          used: 55,
          unit: "percent",
          fidelity: "estimated",
        }),
      ],
    };
    expect(limitKeySvg(claudeCode, "5h", now)).toContain(">~45%</text>");
    expect(limitKeySvg(codex, "5h", now)).not.toContain("~");
  });

  it("renders a dollar-metered window without pretending it is a percentage", () => {
    const openCodeGo: LimitSnapshot = {
      agent: "opencode",
      observedAt: now,
      windows: [
        buildWindow({
          minutes: 300,
          used: 8.4,
          limit: 12,
          unit: "usd",
          fidelity: "exact",
        }),
      ],
    };
    const svg = limitKeySvg(openCodeGo, "5h", now);
    expect(svg).toContain(">5H LEFT</text>");
    expect(svg).toContain(">$3.60</text>");
  });

  it("shows raw consumption when the vendor publishes no cap", () => {
    const uncapped: LimitSnapshot = {
      agent: "opencode",
      observedAt: now,
      windows: [
        buildWindow({
          id: "session",
          used: 128_000,
          unit: "tokens",
          fidelity: "exact",
        }),
      ],
    };
    const svg = limitKeySvg(uncapped, "session", now);
    expect(svg).toContain(">SESSION USED</text>");
    expect(svg).toContain(">128K</text>");
  });
});

describe("limit key view cycling", () => {
  it("walks every window then the balance and wraps", () => {
    expect(nextLimitView(codex, undefined)).toBe("5h");
    expect(nextLimitView(codex, "5h")).toBe("weekly");
    expect(nextLimitView(codex, "weekly")).toBe("balance");
    expect(nextLimitView(codex, "balance")).toBe("5h");
  });

  it("offers no view when the vendor published nothing", () => {
    expect(nextLimitView(undefined, undefined)).toBe(undefined);
  });

  it("restarts the cycle when the stored view is no longer published", () => {
    const weeklyOnly = { ...codex, windows: [codex.windows[1]!] };
    expect(nextLimitView(weeklyOnly, "5h")).toBe("weekly");
  });
});
