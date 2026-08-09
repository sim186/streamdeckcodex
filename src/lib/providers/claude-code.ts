import { claudeCodeStore } from "../claude-code/store.js";
import { CLAUDE_CODE_AGENT_ID } from "../claude-code/limits.js";
import type { AgentProvider } from "./types.js";

export const CLAUDE_CODE_PROVIDER_ID = CLAUDE_CODE_AGENT_ID;

/**
 * Claude Code behind the shared provider seam.
 *
 * It implements the required core only. There is no model member because the
 * CLI exposes no programmatic model switch, no reasoning member because it has
 * no reasoning selector, and no approvalMode member because permission mode
 * cannot be read or changed from outside the process. Omitting them is the
 * capability signal — keys gate on supports() and simply do not offer controls
 * this backend cannot honour.
 */
export const claudeCodeProvider: AgentProvider = {
  id: CLAUDE_CODE_PROVIDER_ID,
  label: "Claude Code",

  listSessions(limit) {
    return limit === undefined
      ? claudeCodeStore.sessions()
      : claudeCodeStore.sessions(limit);
  },
  focusedSession() {
    return claudeCodeStore.focusedSession();
  },
  latestSession() {
    return claudeCodeStore.latestSession();
  },
  acknowledge(sessionId, at) {
    if (at === undefined) claudeCodeStore.acknowledge(sessionId);
    else claudeCodeStore.acknowledge(sessionId, at);
  },
  async limits() {
    return claudeCodeStore.limitsSnapshot();
  },
  context() {
    return claudeCodeStore.contextSnapshot();
  },

  async refresh() {
    claudeCodeStore.invalidate();
  },
  invalidate() {
    claudeCodeStore.invalidate();
  },
  close() {
    claudeCodeStore.close();
  },
};
