import { codexStore } from "../codex-store.js";
import type { AgentProvider } from "./types.js";

export const CODEX_PROVIDER_ID = "codex";

/**
 * Codex behind the shared provider seam.
 *
 * Every member delegates to the existing store rather than reimplementing it,
 * and does so lazily so a test that replaces the store module still sees its
 * own double.
 */
export const codexProvider: AgentProvider = {
  id: CODEX_PROVIDER_ID,
  label: "Codex",

  listSessions(limit) {
    return limit === undefined
      ? codexStore.sessions()
      : codexStore.sessions(limit);
  },
  focusedSession() {
    return codexStore.focusedThread();
  },
  limits() {
    return codexStore.limitsSnapshot();
  },
  context() {
    return codexStore.contextSnapshot();
  },

  async refresh() {
    await codexStore.refreshLiveComposer();
  },
  invalidate() {
    codexStore.invalidate();
  },
  close() {
    codexStore.close();
  },

  model: () => codexStore.modelSnapshot(),
  reasoning: () => codexStore.reasoningSnapshot(),
  approvalMode: {
    current: () => codexStore.liveComposerState()?.approvalMode,
    cycle: () => codexStore.cycleLiveComposerApprovalMode(),
  },
};
