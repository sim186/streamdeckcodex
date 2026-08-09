import { expect, it } from "vitest";
import type { AgentProvider } from "../../src/lib/providers/types.js";
import { featuresOf, supports } from "../../src/lib/providers/types.js";
import { limitViews, usedPercentOf } from "../../src/lib/limits.js";

/**
 * Behaviour every backend must satisfy, independent of which agent it drives.
 *
 * Run this against each new provider — Claude Code, OpenCode — so a backend
 * that reports a limit window in the wrong unit, or claims a feature it cannot
 * perform, fails here rather than on a key that silently renders nothing.
 */
export function describeAgentProviderContract(
  build: () => AgentProvider,
): void {
  it("identifies itself with a non-empty id and label", () => {
    const provider = build();
    expect(provider.id).toMatch(/\S/);
    expect(provider.label).toMatch(/\S/);
  });

  it("returns sessions as an array and honours a requested limit", () => {
    const provider = build();
    expect(Array.isArray(provider.listSessions())).toBe(true);
    expect(provider.listSessions(2).length).toBeLessThanOrEqual(2);
  });

  it("reports a limits snapshot whose windows are internally consistent", async () => {
    const snapshot = await build().limits();
    if (snapshot === undefined) return;
    expect(snapshot.windows.length).toBeGreaterThan(0);
    expect(new Set(snapshot.windows.map((window) => window.id)).size).toBe(
      snapshot.windows.length,
    );
    for (const window of snapshot.windows) {
      expect(window.label).toMatch(/\S/);
      expect(window.used).toBeGreaterThanOrEqual(0);
      const percent = usedPercentOf(window);
      if (percent !== undefined) {
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(100);
      }
      if (window.unit !== "percent" && window.limit === undefined) {
        expect(percent).toBe(undefined);
      }
    }
  });

  it("attributes its limits snapshot to itself", async () => {
    const provider = build();
    const snapshot = await provider.limits();
    if (snapshot === undefined) return;
    expect(snapshot.agent).toBe(provider.id);
  });

  it("offers at least one cycleable view whenever it reports limits", async () => {
    const snapshot = await build().limits();
    if (snapshot === undefined) return;
    expect(limitViews(snapshot).length).toBeGreaterThan(0);
  });

  it("returns a listed session as its latest, when it has one", () => {
    const provider = build();
    const latest = provider.latestSession();
    if (latest === undefined) return;
    expect(latest.id).toMatch(/\S/);
  });

  it("accepts acknowledgement of any session id without throwing", () => {
    const provider = build();
    expect(() =>
      provider.acknowledge("session-that-does-not-exist"),
    ).not.toThrow();
    expect(() => provider.acknowledge("session-1", 1)).not.toThrow();
  });

  it("keeps context percentages within range when it reports context", () => {
    const context = build().context();
    if (context === undefined) return;
    expect(context.remainingPercent).toBeGreaterThanOrEqual(0);
    expect(context.remainingPercent).toBeLessThanOrEqual(100);
    expect(context.maxTokens).toBeGreaterThan(0);
  });

  it("exposes only the optional features it actually implements", () => {
    const provider = build();
    for (const feature of featuresOf(provider)) {
      expect(supports(provider, feature)).toBe(true);
      expect(provider[feature]).toBeDefined();
    }
    if (supports(provider, "model")) {
      expect(Array.isArray(provider.model!().options)).toBe(true);
    }
    if (supports(provider, "reasoning")) {
      expect(Array.isArray(provider.reasoning!().levels)).toBe(true);
    }
  });

  it("survives lifecycle calls in any order", async () => {
    const provider = build();
    await provider.refresh();
    provider.invalidate();
    provider.invalidate();
    await expect(provider.limits()).resolves.not.toThrow();
    provider.close();
  });
}
