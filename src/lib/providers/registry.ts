import { codexProvider } from "./codex.js";
import type { AgentProvider } from "./types.js";

const providers = new Map<string, AgentProvider>();
let activeId: string | undefined;

export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.id, provider);
  activeId ??= provider.id;
}

export function getProvider(id: string): AgentProvider | undefined {
  return providers.get(id);
}

export function allProviders(): AgentProvider[] {
  return [...providers.values()];
}

/**
 * The provider keys draw from today. Only one backend is wired up, so this is
 * currently constant; it exists so keys read through the seam from the start
 * rather than being rewritten when a second backend lands.
 */
export function activeProvider(): AgentProvider {
  const provider = activeId ? providers.get(activeId) : undefined;
  if (!provider) throw new Error("No agent provider is registered");
  return provider;
}

export function setActiveProvider(id: string): void {
  if (!providers.has(id)) {
    throw new Error(`Cannot activate unregistered agent provider: ${id}`);
  }
  activeId = id;
}

/** Test seam: drops every registration, including the built-in default. */
export function resetProviders(): void {
  providers.clear();
  activeId = undefined;
}

registerProvider(codexProvider);
