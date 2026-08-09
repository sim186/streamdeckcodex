/**
 * Stream Dock's plugin transport.
 *
 * Mirabox's Stream Dock software reuses the command line and event vocabulary
 * of Elgato's original SDK: the host launches the plugin with
 * `-port <n> -pluginUUID <id> -registerEvent <event> -info <json>` and expects
 * a registration frame on a local WebSocket. It does not implement Elgato's
 * SDK v3 additions, so this surface speaks the wire protocol directly instead
 * of going through `@elgato/streamdeck`.
 *
 * Everything here is transport only; nothing in this file knows what a Codex
 * chat or a limit window is.
 */

export interface LaunchArgs {
  port: number;
  uuid: string;
  registerEvent: string;
  info: unknown;
}

export interface StreamDockSocket {
  send(data: string): void;
  on(event: "message", handler: (data: unknown) => void): void;
  on(event: "open" | "close", handler: () => void): void;
  on(event: string, handler: (...args: never[]) => void): void;
}

export interface StreamDockEvent {
  event: string;
  action?: string;
  context?: string;
  device?: string;
  payload?: {
    settings?: Record<string, unknown>;
    coordinates?: { column: number; row: number };
    state?: number;
    ticks?: number;
    [key: string]: unknown;
  };
}

/**
 * Reads the launch arguments by flag name, falling back to the fixed positions
 * the reference SDK reads. Mirabox's own template indexes `process.argv`
 * positionally, so a host that omits a flag name still has to keep the order.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
  const flag = (name: string, position: number): string | undefined => {
    const index = argv.indexOf(`-${name}`);
    if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
    return argv[position];
  };

  const port = Number(flag("port", 3));
  const uuid = flag("pluginUUID", 5);
  const registerEvent = flag("registerEvent", 7);
  const rawInfo = flag("info", 9);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Stream Dock supplied no usable port (received ${port})`);
  }
  if (!uuid) throw new Error("Stream Dock supplied no plugin UUID");
  if (!registerEvent) throw new Error("Stream Dock supplied no register event");

  let info: unknown = {};
  if (rawInfo) {
    try {
      info = JSON.parse(rawInfo);
    } catch {
      // A host that sends unparseable info is still usable; the plugin only
      // reads it for locale hints.
    }
  }
  return { port, uuid, registerEvent, info };
}

export type EventHandler = (event: StreamDockEvent) => void | Promise<void>;

export class StreamDockHost {
  readonly #socket: StreamDockSocket;
  readonly #args: LaunchArgs;
  readonly #handlers = new Map<string, Set<EventHandler>>();
  #onError: (error: unknown) => void;

  constructor(
    socket: StreamDockSocket,
    args: LaunchArgs,
    onError: (error: unknown) => void = () => undefined,
  ) {
    this.#socket = socket;
    this.#args = args;
    this.#onError = onError;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({ uuid: args.uuid, event: args.registerEvent }),
      );
    });
    socket.on("message", (data: unknown) => {
      this.#dispatch(data);
    });
  }

  get info(): unknown {
    return this.#args.info;
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.#handlers.get(event);
    if (existing) existing.add(handler);
    else this.#handlers.set(event, new Set([handler]));
  }

  #dispatch(data: unknown): void {
    let parsed: StreamDockEvent;
    try {
      parsed = JSON.parse(String(data)) as StreamDockEvent;
    } catch {
      return;
    }
    if (typeof parsed?.event !== "string") return;
    for (const handler of this.#handlers.get(parsed.event) ?? []) {
      try {
        const result = handler(parsed);
        if (result instanceof Promise) result.catch(this.#onError);
      } catch (error) {
        this.#onError(error);
      }
    }
  }

  #send(event: string, context: string, payload?: unknown): void {
    this.#socket.send(
      JSON.stringify({
        event,
        context,
        ...(payload === undefined ? {} : { payload }),
      }),
    );
  }

  /**
   * Stream Dock's setImage takes the image on `payload.target`/`payload.image`,
   * matching the original Elgato frame rather than the v3 shape.
   */
  setImage(context: string, image: string): void {
    this.#send("setImage", context, { target: 0, image });
  }

  setTitle(context: string, title: string): void {
    this.#send("setTitle", context, { target: 0, title });
  }

  showOk(context: string): void {
    this.#send("showOk", context);
  }

  showAlert(context: string): void {
    this.#send("showAlert", context);
  }

  setSettings(context: string, settings: Record<string, unknown>): void {
    this.#send("setSettings", context, settings);
  }
}

/**
 * Adapts one Stream Dock key context to the structural interface the shared
 * render cache expects, so both surfaces deduplicate redraws identically.
 */
export function keyRenderTarget(
  host: StreamDockHost,
  context: string,
): {
  setImage(value: string): Promise<void>;
  setTitle(value: string): Promise<void>;
} {
  return {
    async setImage(value: string) {
      host.setImage(context, value);
    },
    async setTitle(value: string) {
      host.setTitle(context, value);
    },
  };
}
