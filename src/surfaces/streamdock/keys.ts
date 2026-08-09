import type { ContextView } from "../../lib/context.js";
import { limitViews, nextLimitView } from "../../lib/limits.js";
import { activeProvider } from "../../lib/providers/registry.js";
import { renderKey } from "../../lib/render-cache.js";
import {
  agentKeySvg,
  contextKeySvg,
  limitKeySvg,
  svgDataUrl,
} from "../../lib/visuals.js";
import type { LimitSnapshot } from "../../types.js";
import { keyRenderTarget, type StreamDockHost } from "./protocol.js";

/**
 * The keys this surface draws.
 *
 * Stream Dock has no bundled-profile mechanism, so a user places these
 * manually. The action ids are therefore stable and self-describing rather
 * than mirroring the Elgato profile's internal names.
 */
export type StreamDockKeyKind = "agent" | "quota" | "context";

export function keyKindOf(actionUuid: string): StreamDockKeyKind | undefined {
  const suffix = actionUuid.split(".").pop();
  if (suffix === "agent" || suffix === "quota" || suffix === "context") {
    return suffix;
  }
  return undefined;
}

interface KeyState {
  kind: StreamDockKeyKind;
  slot: number;
  limitView?: string;
  contextView: ContextView;
}

function slotOf(settings: Record<string, unknown> | undefined): number {
  const raw = settings?.["slot"];
  const slot = typeof raw === "string" ? Number(raw) : raw;
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 0
    ? slot
    : 0;
}

/**
 * Owns the visible keys for a Stream Dock device and redraws them on demand.
 *
 * The renderers, providers, and render cache are shared verbatim with the
 * Elgato surface; only event plumbing differs between the two.
 */
export class StreamDockKeys {
  readonly #host: StreamDockHost;
  readonly #keys = new Map<string, KeyState>();

  constructor(host: StreamDockHost) {
    this.#host = host;
    host.on("willAppear", (event) => this.#appear(event));
    host.on("willDisappear", ({ context }) => {
      if (context) this.#keys.delete(context);
    });
    host.on("keyUp", (event) => this.#press(event));
    host.on("didReceiveSettings", (event) => this.#appear(event));
  }

  get visibleContexts(): string[] {
    return [...this.#keys.keys()];
  }

  async #appear(event: {
    action?: string;
    context?: string;
    payload?: { settings?: Record<string, unknown> };
  }): Promise<void> {
    const kind = keyKindOf(event.action ?? "");
    if (kind === undefined || !event.context) return;
    this.#keys.set(event.context, {
      kind,
      slot: slotOf(event.payload?.settings),
      contextView: "remaining",
    });
    await this.draw(event.context);
  }

  async #press(event: { context?: string }): Promise<void> {
    const context = event.context;
    const state = context ? this.#keys.get(context) : undefined;
    if (!context || state === undefined) return;

    if (state.kind === "quota") {
      const snapshot = await activeProvider().limits();
      const next = nextLimitView(snapshot, this.#limitView(state, snapshot));
      if (next === undefined) delete state.limitView;
      else state.limitView = next;
    } else if (state.kind === "context") {
      state.contextView =
        state.contextView === "remaining" ? "exact" : "remaining";
    } else {
      const session = activeProvider().listSessions()[state.slot];
      if (session === undefined) {
        this.#host.showAlert(context);
        return;
      }
      activeProvider().acknowledge(session.id);
      this.#host.showOk(context);
    }
    await this.draw(context);
  }

  #limitView(
    state: KeyState,
    snapshot: LimitSnapshot | undefined,
  ): string | undefined {
    const views = limitViews(snapshot);
    if (state.limitView !== undefined && views.includes(state.limitView)) {
      return state.limitView;
    }
    return views[0];
  }

  async draw(context: string): Promise<void> {
    const state = this.#keys.get(context);
    if (state === undefined) return;
    const target = keyRenderTarget(this.#host, context);
    const provider = activeProvider();

    if (state.kind === "quota") {
      const snapshot = await provider.limits();
      await renderKey(
        target,
        svgDataUrl(limitKeySvg(snapshot, this.#limitView(state, snapshot))),
      );
      return;
    }
    if (state.kind === "context") {
      await renderKey(
        target,
        svgDataUrl(contextKeySvg(provider.context(), state.contextView)),
      );
      return;
    }
    await renderKey(
      target,
      svgDataUrl(agentKeySvg(provider.listSessions()[state.slot], state.slot)),
    );
  }

  async drawAll(): Promise<void> {
    await Promise.all(
      this.visibleContexts.map((context) => this.draw(context)),
    );
  }
}
