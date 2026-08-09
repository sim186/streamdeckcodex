import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  budgetsFromEnv,
  estimateClaudeCodeLimits,
} from "../src/lib/claude-code/limits.js";
import {
  claudeCodeHome,
  contextTokensOf,
  listTranscripts,
  parseTranscriptEvents,
  sessionTitleOf,
} from "../src/lib/claude-code/transcripts.js";
import { ClaudeCodeStore } from "../src/lib/claude-code/store.js";
import { usedPercentOf } from "../src/lib/limits.js";
import { describeAgentProviderContract } from "./helpers/provider-contract.js";
import type { AgentProvider } from "../src/lib/providers/types.js";

const NOW = Date.parse("2026-08-09T12:00:00Z");
const minutesAgo = (minutes: number): string =>
  new Date(NOW - minutes * 60_000).toISOString();

function transcript(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

const assistantTurn = (
  minutes: number,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({
  type: "assistant",
  timestamp: minutesAgo(minutes),
  cwd: "/Users/example/code/app",
  sessionId: "session-a",
  message: {
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Done." }],
    usage,
    ...extra,
  },
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "claude-projects-"));
  const dir = join(root, "-Users-example-code-app");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    writeFileSync(path, content);
    utimesSync(path, new Date(NOW), new Date(NOW));
  }
  return root;
}

describe("transcript discovery", () => {
  it("reports no sessions when Claude Code has never run here", () => {
    expect(
      listTranscripts(join(tmpdir(), "definitely-absent-projects")),
    ).toEqual([]);
  });

  it("lists transcripts newest first and ignores non-transcript files", () => {
    const root = project({
      "session-a.jsonl": transcript([assistantTurn(10, {})]),
      "session-b.jsonl": transcript([assistantTurn(20, {})]),
      "notes.txt": "ignored",
    });
    const older = join(root, "-Users-example-code-app", "session-b.jsonl");
    utimesSync(older, new Date(NOW - 60_000), new Date(NOW - 60_000));

    const found = listTranscripts(root);
    expect(found.map(({ sessionId }) => sessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("resolves the config home from the environment", () => {
    expect(claudeCodeHome({ CLAUDE_CONFIG_DIR: "/custom/claude" })).toBe(
      "/custom/claude",
    );
    expect(claudeCodeHome({})).toMatch(/\.claude$/);
  });
});

describe("transcript parsing", () => {
  it("survives malformed lines, blank lines, and unknown records", () => {
    const events = parseTranscriptEvents(
      ["not json", "", "{broken", JSON.stringify({ type: "mystery" })].join(
        "\n",
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.role).toBe("mystery");
  });

  it("extracts role, cwd, usage, and text from an assistant turn", () => {
    const events = parseTranscriptEvents(
      transcript([
        assistantTurn(5, {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 10,
        }),
      ]),
    );
    expect(events[0]).toMatchObject({
      role: "assistant",
      cwd: "/Users/example/code/app",
      text: "Done.",
      stopped: true,
      toolUse: false,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        cacheCreationTokens: 10,
      },
    });
  });

  it("treats a turn that ended on a tool call as unfinished", () => {
    const events = parseTranscriptEvents(
      transcript([
        {
          type: "assistant",
          timestamp: minutesAgo(1),
          message: {
            role: "assistant",
            stop_reason: "tool_use",
            content: [{ type: "tool_use", name: "Read" }],
          },
        },
      ]),
    );
    expect(events[0]?.stopped).toBe(false);
    expect(events[0]?.toolUse).toBe(true);
  });

  it("omits usage entirely when every counter is absent or zero", () => {
    const events = parseTranscriptEvents(
      transcript([assistantTurn(1, { input_tokens: 0 })]),
    );
    expect(events[0]?.usage).toBe(undefined);
  });

  it("measures live context from the newest turn, excluding output", () => {
    const events = parseTranscriptEvents(
      transcript([
        assistantTurn(30, { input_tokens: 10, cache_read_input_tokens: 10 }),
        assistantTurn(5, {
          input_tokens: 1_000,
          output_tokens: 500,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 2_000,
        }),
      ]),
    );
    expect(contextTokensOf(events)).toBe(43_000);
  });

  it("prefers a summary over the first user message for a title", () => {
    const withSummary = parseTranscriptEvents(
      transcript([
        { type: "summary", summary: "Fix the parser" },
        {
          type: "user",
          message: { role: "user", content: "please fix the parser" },
        },
      ]),
    );
    expect(sessionTitleOf(withSummary)).toBe("Fix the parser");

    const withoutSummary = parseTranscriptEvents(
      transcript([
        { type: "user", message: { role: "user", content: "please fix it" } },
      ]),
    );
    expect(sessionTitleOf(withoutSummary)).toBe("please fix it");
  });
});

describe("estimated Claude Code limits", () => {
  const events = parseTranscriptEvents(
    transcript([
      assistantTurn(60, {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 90_000,
      }),
      assistantTurn(6_000, { input_tokens: 4_000, output_tokens: 1_000 }),
    ]),
  );

  it("never reports an inferred window as vendor-published", () => {
    const snapshot = estimateClaudeCodeLimits(events, {}, NOW);
    expect(snapshot?.agent).toBe("claude-code");
    expect(
      snapshot?.windows.every((window) => window.fidelity === "estimated"),
    ).toBe(true);
  });

  it("counts only the turns inside each window", () => {
    const snapshot = estimateClaudeCodeLimits(events, {}, NOW);
    const fiveHour = snapshot?.windows.find((window) => window.id === "5h");
    const weekly = snapshot?.windows.find((window) => window.id === "weekly");
    expect(fiveHour?.used).toBe(2_000);
    expect(weekly?.used).toBe(7_000);
  });

  it("publishes no percentage while no token cap is configured", () => {
    const snapshot = estimateClaudeCodeLimits(events, {}, NOW);
    const fiveHour = snapshot?.windows.find((window) => window.id === "5h")!;
    expect(fiveHour.limit).toBe(undefined);
    expect(usedPercentOf(fiveHour)).toBe(undefined);
  });

  it("derives a percentage once the operator supplies a budget", () => {
    const snapshot = estimateClaudeCodeLimits(
      events,
      { fiveHourTokens: 8_000 },
      NOW,
    );
    const fiveHour = snapshot?.windows.find((window) => window.id === "5h")!;
    expect(usedPercentOf(fiveHour)).toBe(25);
  });

  it("dates the reset from the first activity still inside the window", () => {
    const snapshot = estimateClaudeCodeLimits(events, {}, NOW);
    const fiveHour = snapshot?.windows.find((window) => window.id === "5h")!;
    expect(fiveHour.resetsAt).toBe(
      Math.round((NOW - 60 * 60_000 + 300 * 60_000) / 1000),
    );
  });

  it("reports nothing when no turn falls inside any window", () => {
    const stale = parseTranscriptEvents(
      transcript([assistantTurn(60 * 24 * 30, { input_tokens: 10 })]),
    );
    expect(estimateClaudeCodeLimits(stale, {}, NOW)).toBe(undefined);
  });

  it("reads budgets from the environment and rejects nonsense values", () => {
    expect(
      budgetsFromEnv({
        STREAMDECK_CLAUDE_5H_TOKEN_BUDGET: "5000",
        STREAMDECK_CLAUDE_WEEKLY_TOKEN_BUDGET: "not-a-number",
      }),
    ).toEqual({ fiveHourTokens: 5_000 });
    expect(budgetsFromEnv({ STREAMDECK_CLAUDE_5H_TOKEN_BUDGET: "-1" })).toEqual(
      {},
    );
  });
});

describe("Claude Code store", () => {
  it("projects transcripts into sessions with titles and status", () => {
    const root = project({
      "session-a.jsonl": transcript([
        { type: "summary", summary: "Fix the parser" },
        assistantTurn(5, { input_tokens: 100, cache_read_input_tokens: 1_000 }),
      ]),
    });
    const store = new ClaudeCodeStore(root, () => NOW);
    const [session] = store.sessions();
    expect(session).toMatchObject({
      id: "session-a",
      displayTitle: "Fix the parser",
      cwd: "/Users/example/code/app",
      sessionIndex: 0,
      isActive: true,
    });
    expect(session?.status).toBe("unread");
  });

  it("clears unread once the session is acknowledged", () => {
    const root = project({
      "session-a.jsonl": transcript([assistantTurn(5, { input_tokens: 10 })]),
    });
    const store = new ClaudeCodeStore(root, () => NOW);
    expect(store.sessions()[0]?.status).toBe("unread");
    store.acknowledge("session-a", NOW);
    expect(store.sessions()[0]?.status).toBe("idle");
  });

  it("reports context as a share of the model window", () => {
    const root = project({
      "session-a.jsonl": transcript([
        assistantTurn(5, {
          input_tokens: 20_000,
          cache_read_input_tokens: 20_000,
        }),
      ]),
    });
    const context = new ClaudeCodeStore(root, () => NOW).contextSnapshot();
    expect(context).toMatchObject({
      threadId: "session-a",
      usedTokens: 40_000,
    });
    expect(context?.remainingPercent).toBe(80);
  });

  it("reports no session at all when the projects directory is absent", () => {
    const store = new ClaudeCodeStore(join(tmpdir(), "absent"), () => NOW);
    expect(store.sessions()).toEqual([]);
    expect(store.latestSession()).toBe(undefined);
    expect(store.contextSnapshot()).toBe(undefined);
    expect(store.limitsSnapshot()).toBe(undefined);
  });
});

describe("Claude Code provider satisfies the agent provider contract", () => {
  let provider: AgentProvider | undefined;

  afterEach(() => {
    provider?.close();
  });

  describeAgentProviderContract(() => {
    const root = project({
      "session-a.jsonl": transcript([
        { type: "summary", summary: "Fix the parser" },
        assistantTurn(5, {
          input_tokens: 1_000,
          cache_read_input_tokens: 2_000,
        }),
      ]),
      "session-b.jsonl": transcript([assistantTurn(30, { input_tokens: 10 })]),
    });
    const store = new ClaudeCodeStore(root, () => NOW);
    provider = {
      id: "claude-code",
      label: "Claude Code",
      listSessions: (limit) =>
        limit === undefined ? store.sessions() : store.sessions(limit),
      focusedSession: () => store.focusedSession(),
      latestSession: () => store.latestSession(),
      acknowledge: (sessionId, at) =>
        at === undefined
          ? store.acknowledge(sessionId)
          : store.acknowledge(sessionId, at),
      limits: async () => store.limitsSnapshot(),
      context: () => store.contextSnapshot(),
      refresh: async () => store.invalidate(),
      invalidate: () => store.invalidate(),
      close: () => store.close(),
    };
    return provider;
  });
});
