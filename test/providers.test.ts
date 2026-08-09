import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWindow } from "../src/lib/limits.js";
import { describeAgentProviderContract } from "./helpers/provider-contract.js";
import type { AgentProvider } from "../src/lib/providers/types.js";
import { featuresOf, supports } from "../src/lib/providers/types.js";

const store = {
  sessions: vi.fn((limit = 8) =>
    [
      { id: "thread-1", sessionIndex: 0 },
      { id: "thread-2", sessionIndex: 1 },
      { id: "thread-3", sessionIndex: 2 },
    ].slice(0, limit),
  ),
  focusedThread: vi.fn(() => ({ id: "thread-1" })),
  latestThread: vi.fn(() => ({ id: "thread-1" })),
  acknowledge: vi.fn(),
  limitsSnapshot: vi.fn(async () => ({
    agent: "codex",
    observedAt: 0,
    windows: [
      buildWindow({
        minutes: 300,
        used: 12,
        unit: "percent",
        fidelity: "exact",
      }),
      buildWindow({
        minutes: 10_080,
        used: 42,
        unit: "percent",
        fidelity: "exact",
      }),
    ],
    balance: { amount: 3, unit: "credits" as const, label: "RESETS" },
  })),
  contextSnapshot: vi.fn(() => ({
    threadId: "thread-1",
    usedTokens: 1_000,
    maxTokens: 258_000,
    remainingPercent: 99,
    observedAt: 0,
  })),
  modelSnapshot: vi.fn(() => ({ current: "luna", options: [] })),
  reasoningSnapshot: vi.fn(() => ({ current: "medium", levels: ["medium"] })),
  liveComposerState: vi.fn(() => ({ approvalMode: "ask" })),
  cycleLiveComposerApprovalMode: vi.fn(async () => "approve"),
  refreshLiveComposer: vi.fn(async () => undefined),
  invalidate: vi.fn(),
  close: vi.fn(),
};

vi.mock("../src/lib/codex-store.js", () => ({ codexStore: store }));

const { codexProvider } = await import("../src/lib/providers/codex.js");
const registry = await import("../src/lib/providers/registry.js");

describe("Codex provider satisfies the agent provider contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describeAgentProviderContract(() => codexProvider);
});

describe("Codex provider delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes a requested session limit through to the store", () => {
    codexProvider.listSessions(2);
    expect(store.sessions).toHaveBeenCalledWith(2);
  });

  it("lets the store choose its own default when no limit is requested", () => {
    codexProvider.listSessions();
    expect(store.sessions).toHaveBeenCalledWith();
  });

  it("reads the approval mode from the live composer", () => {
    expect(codexProvider.approvalMode?.current()).toBe("ask");
    store.liveComposerState.mockReturnValueOnce(
      undefined as unknown as { approvalMode: string },
    );
    expect(codexProvider.approvalMode?.current()).toBe(undefined);
  });

  it("cycles the approval mode through the store", async () => {
    await expect(codexProvider.approvalMode?.cycle()).resolves.toBe("approve");
    expect(store.cycleLiveComposerApprovalMode).toHaveBeenCalledOnce();
  });

  it("advertises every optional feature Codex implements", () => {
    expect(featuresOf(codexProvider).sort()).toEqual([
      "approvalMode",
      "model",
      "reasoning",
    ]);
  });
});

describe("feature detection", () => {
  const minimal: AgentProvider = {
    id: "minimal",
    label: "Minimal",
    listSessions: () => [],
    focusedSession: () => undefined,
    latestSession: () => undefined,
    acknowledge: () => undefined,
    limits: async () => undefined,
    context: () => undefined,
    refresh: async () => undefined,
    invalidate: () => undefined,
    close: () => undefined,
  };

  it("reports nothing optional for a backend that implements only the core", () => {
    expect(featuresOf(minimal)).toEqual([]);
    expect(supports(minimal, "model")).toBe(false);
    expect(supports(minimal, "approvalMode")).toBe(false);
  });

  describe("a core-only backend still satisfies the contract", () => {
    describeAgentProviderContract(() => minimal);
  });
});

describe("provider registry", () => {
  it("registers Codex as the default active provider", () => {
    expect(registry.activeProvider().id).toBe("codex");
    expect(registry.getProvider("codex")).toBe(codexProvider);
  });

  it("registers Claude Code without making it active", () => {
    expect(registry.getProvider("claude-code")?.label).toBe("Claude Code");
    expect(registry.activeProvider().id).toBe("codex");
  });

  it("refuses to activate a backend that was never registered", () => {
    expect(() => registry.setActiveProvider("goose")).toThrow(/unregistered/i);
    expect(registry.activeProvider().id).toBe("codex");
  });

  it("switches between registered backends", () => {
    const second: AgentProvider = {
      ...codexProvider,
      id: "opencode",
      label: "OpenCode",
    };
    registry.registerProvider(second);
    try {
      expect(registry.allProviders().map(({ id }) => id)).toContain("opencode");
      registry.setActiveProvider("opencode");
      expect(registry.activeProvider().id).toBe("opencode");
    } finally {
      registry.setActiveProvider("codex");
    }
  });

  it("activates the backend named by the environment", () => {
    try {
      expect(
        registry.applyConfiguredProvider({ STREAMDECK_AGENT: "claude-code" }),
      ).toEqual({ id: "claude-code" });
      expect(registry.activeProvider().id).toBe("claude-code");
    } finally {
      registry.setActiveProvider("codex");
    }
  });

  it("keeps the default and explains itself when the name is unknown", () => {
    const result = registry.applyConfiguredProvider({
      STREAMDECK_AGENT: "cloud-code",
    });
    expect(result.id).toBe("codex");
    expect(result.error).toMatch(/Unknown STREAMDECK_AGENT/);
    expect(result.error).toMatch(/claude-code/);
    expect(registry.activeProvider().id).toBe("codex");
  });

  it("leaves the default in place when nothing is configured", () => {
    expect(registry.applyConfiguredProvider({})).toEqual({ id: "codex" });
    expect(
      registry.applyConfiguredProvider({ STREAMDECK_AGENT: "  " }),
    ).toEqual({ id: "codex" });
  });

  it("reports a clear failure when nothing is registered", () => {
    const snapshot = registry.allProviders();
    registry.resetProviders();
    try {
      expect(() => registry.activeProvider()).toThrow(/No agent provider/);
    } finally {
      for (const provider of snapshot) registry.registerProvider(provider);
      registry.setActiveProvider("codex");
    }
  });
});
