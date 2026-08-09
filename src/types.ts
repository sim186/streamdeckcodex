export type AgentStatus =
  "off" | "idle" | "unread" | "thinking" | "running" | "needs-input" | "error";

export interface ThreadRecord {
  id: string;
  rolloutPath: string;
  cwd: string;
  title: string;
  preview: string;
  recencyAtMs: number;
  reasoningEffort?: string;
  model?: string;
  spawnStatus?: string;
}

export interface RolloutState {
  status: AgentStatus;
  lastEventAt: number;
  completedAt?: number;
  detail?: string;
}

export interface AgentSnapshot extends ThreadRecord, RolloutState {
  displayTitle: string;
}

export interface SessionSnapshot extends AgentSnapshot {
  sessionLabel: string;
  sessionIndex: number;
  isActive: boolean;
}

export interface ReasoningSnapshot {
  current: string;
  levels: string[];
  threadId?: string;
  model?: string;
}

export interface ModelOption {
  slug: string;
  label: string;
}

export interface ModelSnapshot {
  current: string;
  options: ModelOption[];
  threadId?: string;
}

/**
 * How a vendor meters a limit window. Codex and Claude Code report a
 * percentage of an opaque allowance; OpenCode Go meters in dollars against a
 * published cap; API-key backends only ever know token counts.
 */
export type LimitUnit = "percent" | "usd" | "tokens";

/**
 * Whether the vendor published the number or the companion inferred it.
 * An inferred value must never be rendered as if the vendor confirmed it.
 */
export type LimitFidelity = "exact" | "estimated";

export interface LimitWindow {
  /** Canonical window id: `5h`, `weekly`, `monthly`, or a derived fallback. */
  id: string;
  label: string;
  used: number;
  /** Absent when the vendor reports consumption without publishing the cap. */
  limit?: number;
  unit: LimitUnit;
  /** Epoch seconds, matching Codex's `resets_at`. */
  resetsAt?: number;
  fidelity: LimitFidelity;
}

/**
 * An overflow pool that absorbs requests once a window is exhausted: Codex's
 * banked resets, or the Zen balance behind an OpenCode Go subscription.
 * Orthogonal to windows — a vendor can expose both at once.
 */
export interface LimitBalance {
  amount: number;
  unit: "usd" | "credits";
  label: string;
}

export interface LimitSnapshot {
  agent: string;
  /** Vendor account or plan, when the backend identifies one. */
  account?: string;
  windows: LimitWindow[];
  balance?: LimitBalance;
  observedAt: number;
}

export interface ContextSnapshot {
  threadId: string;
  usedTokens: number;
  maxTokens: number;
  remainingPercent: number;
  observedAt: number;
}
