import type { LimitSnapshot } from "../types.js";
import {
  action,
  type Action,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { activeProvider } from "../lib/providers/registry.js";
import { limitViews, nextLimitView } from "../lib/limits.js";
import { svgDataUrl, limitKeySvg } from "../lib/visuals.js";
import { renderKey } from "../lib/render-cache.js";

@action({ UUID: "com.todd.streamdeckcodex.usage" })
export class UsageAction extends SingletonAction {
  readonly #view = new Map<string, string>();

  async onWillAppear(event: WillAppearEvent): Promise<void> {
    if (!event.action.isKey()) return;
    this.#view.delete(event.action.id);
    await this.draw(event.action);
  }

  async onKeyDown(event: KeyDownEvent): Promise<void> {
    const snapshot = await activeProvider().limits();
    // Advance from what the key is showing, not from what was stored: an
    // untouched key displays the first view without having recorded it.
    const next = nextLimitView(snapshot, this.view(event.action.id, snapshot));
    if (next === undefined) this.#view.delete(event.action.id);
    else this.#view.set(event.action.id, next);
    await this.draw(event.action);
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      [...this.actions]
        .filter((visible) => visible.isKey())
        .map((visible) => this.draw(visible)),
    );
  }

  private async draw(actionInstance: Action): Promise<void> {
    if (!actionInstance.isKey()) return;
    const snapshot = await activeProvider().limits();
    await renderKey(
      actionInstance,
      svgDataUrl(limitKeySvg(snapshot, this.view(actionInstance.id, snapshot))),
    );
  }

  /**
   * Falls back to the first published window whenever the stored view is
   * absent or no longer offered, so a vendor that drops a window mid-session
   * cannot strand the key on a view it can no longer render.
   */
  private view(
    actionId: string,
    snapshot: LimitSnapshot | undefined,
  ): string | undefined {
    const views = limitViews(snapshot);
    const stored = this.#view.get(actionId);
    if (stored !== undefined && views.includes(stored)) return stored;
    return views[0];
  }
}
