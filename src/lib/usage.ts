import { spawn } from "node:child_process";
import type { LimitSnapshot } from "../types.js";
import { resolveCodexBinary } from "./app-server.js";
import { buildWindow } from "./limits.js";

export const CODEX_AGENT_ID = "codex";

interface RolloutRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface TokenCountEvent {
  timestamp?: string;
  payload?: {
    type?: string;
    rate_limits?: {
      primary?: RolloutRateLimitWindow | null;
      secondary?: RolloutRateLimitWindow | null;
    } | null;
  };
}

interface RateLimitWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

interface RateLimitsReadResult {
  rateLimits?: {
    primary?: RateLimitWindow | null;
    secondary?: RateLimitWindow | null;
  };
  rateLimitResetCredits?: {
    availableCount?: number;
  } | null;
}

/**
 * Maps Codex's account rate limits onto the provider-agnostic model, keeping
 * every window the vendor published. Unlike {@link usageFromRateLimitsResult}
 * this does not collapse the 5-hour window into the weekly one.
 */
export function limitsFromRateLimitsResult(
  result: RateLimitsReadResult,
  observedAt = Date.now(),
): LimitSnapshot | undefined {
  const windows = [result.rateLimits?.primary, result.rateLimits?.secondary]
    .filter(
      (window): window is RateLimitWindow =>
        window !== null &&
        window !== undefined &&
        typeof window.usedPercent === "number",
    )
    .map((window) =>
      buildWindow({
        used: window.usedPercent as number,
        unit: "percent",
        fidelity: "exact",
        ...(window.windowDurationMins === undefined
          ? {}
          : { minutes: window.windowDurationMins }),
        ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
      }),
    );
  if (windows.length === 0) return undefined;

  const credits = result.rateLimitResetCredits?.availableCount;
  return {
    agent: CODEX_AGENT_ID,
    windows,
    observedAt,
    ...(typeof credits === "number"
      ? {
          balance: {
            amount: credits,
            unit: "credits" as const,
            label: "RESETS",
          },
        }
      : {}),
  };
}

/**
 * Reads Codex's account rate limits over the bundled app-server. Shared by the
 * legacy usage snapshot and the multi-window limits snapshot so a refresh
 * spawns the app-server once per caller rather than once per model.
 */
export function readAccountRateLimits(
  timeoutMs = 5000,
): Promise<RateLimitsReadResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCodexBinary(), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let buffer = "";
    let settled = false;

    const finish = (
      error: Error | undefined,
      result?: RateLimitsReadResult,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result ?? {});
    };

    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timer = setTimeout(
      () => finish(new Error("Timed out reading Codex account usage")),
      timeoutMs,
    );

    child.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as {
            id?: number;
            result?: RateLimitsReadResult;
            error?: { message?: string };
          };
          if (message.id === 1) {
            if (message.error) {
              finish(
                new Error(
                  message.error.message ?? "Codex initialization failed",
                ),
              );
              return;
            }
            send({ method: "initialized", params: {} });
            send({ method: "account/rateLimits/read", id: 2, params: {} });
          } else if (message.id === 2) {
            if (message.error) {
              finish(
                new Error(message.error.message ?? "Codex usage read failed"),
              );
              return;
            }
            finish(undefined, message.result ?? {});
          }
        } catch {
          // Ignore non-JSON tracing output and wait for the requested response.
        }
      }
    });

    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "streamdeck_codex_companion",
          title: "Stream Deck Codex Companion",
          version: "0.1.0",
        },
      },
    });
  });
}

export async function fetchAccountLimits(
  timeoutMs = 5000,
): Promise<LimitSnapshot> {
  const snapshot = limitsFromRateLimitsResult(
    await readAccountRateLimits(timeoutMs),
    Date.now(),
  );
  if (!snapshot) throw new Error("Codex returned no rate-limit windows");
  return snapshot;
}

/**
 * Reads every rate-limit window from the newest rollout `token_count` event.
 * The fallback path when the app-server is unavailable; values are still
 * vendor-published, so they stay `exact`.
 */
export function parseLatestLimits(lines: string): LimitSnapshot | undefined {
  const entries = lines.split("\n");
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const line = entries[index]!;
    if (!line.includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(line) as TokenCountEvent;
      if (event.payload?.type !== "token_count") continue;
      const windows = [
        event.payload.rate_limits?.primary,
        event.payload.rate_limits?.secondary,
      ]
        .filter(
          (window): window is RolloutRateLimitWindow =>
            window !== null &&
            window !== undefined &&
            typeof window.used_percent === "number",
        )
        .map((window) =>
          buildWindow({
            used: window.used_percent as number,
            unit: "percent",
            fidelity: "exact",
            ...(window.window_minutes === undefined
              ? {}
              : { minutes: window.window_minutes }),
            ...(window.resets_at === undefined
              ? {}
              : { resetsAt: window.resets_at }),
          }),
        );
      if (windows.length === 0) continue;
      const observedAt = Date.parse(event.timestamp ?? "");
      return {
        agent: CODEX_AGENT_ID,
        windows,
        observedAt: Number.isFinite(observedAt) ? observedAt : 0,
      };
    } catch {
      // Ignore malformed or partially written rollout lines.
    }
  }
  return undefined;
}
