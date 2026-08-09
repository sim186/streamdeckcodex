import type {
  AgentSnapshot,
  ContextSnapshot,
  LimitSnapshot,
  ModelSnapshot,
  ReasoningSnapshot,
  SessionSnapshot,
} from "../../types.js";
import type { CodexApprovalMode } from "../codex-ui-control.js";

/**
 * Shared permission vocabulary. Codex names these Ask / Approve for me /
 * Full Access / Custom; other agents expose the same escalation ladder under
 * their own labels and map onto these four.
 */
export type ApprovalMode = CodexApprovalMode;

/**
 * Optional behaviour a backend may expose. Presence of the matching member on
 * the provider is the single source of truth — there is no parallel capability
 * flag to fall out of sync with it.
 */
export type AgentFeature = "model" | "reasoning" | "approvalMode";

export interface ApprovalModeControl {
  current(): ApprovalMode | undefined;
  cycle(): Promise<ApprovalMode>;
}

/**
 * One coding agent the companion can drive.
 *
 * The required members are the ones every backend can answer: which sessions
 * exist, which one is in front, how much of the account allowance is left, and
 * how full the focused session's context is. Everything a backend may not have
 * — a model picker, a reasoning selector, a permission ladder — is optional,
 * and a key that depends on one must check {@link supports} before drawing.
 *
 * Reads are synchronous where the backend is a local file or database and
 * asynchronous only where a process or socket is involved, matching how the
 * data actually arrives rather than flattening everything to promises.
 */
export interface AgentProvider {
  readonly id: string;
  readonly label: string;

  listSessions(limit?: number): SessionSnapshot[];
  focusedSession(): AgentSnapshot | undefined;
  latestSession(): AgentSnapshot | undefined;
  limits(): Promise<LimitSnapshot | undefined>;
  context(): ContextSnapshot | undefined;

  /**
   * Marks a finished session as seen. Backends that do not track unread state
   * implement this as a no-op rather than omitting it, so callers never have
   * to ask whether acknowledgement is available.
   */
  acknowledge(sessionId: string, at?: number): void;

  /** Pulls whatever the backend cannot observe passively. */
  refresh(): Promise<void>;
  /** Drops cached reads so the next call re-reads the backend. */
  invalidate(): void;
  close(): void;

  model?: () => ModelSnapshot;
  reasoning?: () => ReasoningSnapshot;
  approvalMode?: ApprovalModeControl;
}

export function supports(
  provider: AgentProvider,
  feature: AgentFeature,
): boolean {
  return provider[feature] !== undefined;
}

export function featuresOf(provider: AgentProvider): AgentFeature[] {
  return (["model", "reasoning", "approvalMode"] as const).filter((feature) =>
    supports(provider, feature),
  );
}

/**
 * Resolves an optional feature or fails with the backend named. A key wired to
 * a control its provider does not implement is a configuration error, and
 * saying which agent lacks what beats an undefined call deep in a renderer.
 */
export function requireFeature<Feature extends AgentFeature>(
  provider: AgentProvider,
  feature: Feature,
): NonNullable<AgentProvider[Feature]> {
  const member = provider[feature];
  if (member === undefined) {
    throw new Error(`${provider.label} does not support ${feature}`);
  }
  return member as NonNullable<AgentProvider[Feature]>;
}
