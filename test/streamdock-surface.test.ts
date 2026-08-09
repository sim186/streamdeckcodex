import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWindow } from "../src/lib/limits.js";
import {
  keyRenderTarget,
  parseLaunchArgs,
  StreamDockHost,
  type StreamDockSocket,
} from "../src/surfaces/streamdock/protocol.js";

const limits = {
  agent: "codex",
  observedAt: 0,
  windows: [
    buildWindow({ minutes: 300, used: 12, unit: "percent", fidelity: "exact" }),
    buildWindow({
      minutes: 10_080,
      used: 42,
      unit: "percent",
      fidelity: "exact",
    }),
  ],
};

const provider = {
  id: "codex",
  label: "Codex",
  listSessions: vi.fn(() => [
    { id: "thread-1", displayTitle: "First", status: "idle", sessionIndex: 0 },
  ]),
  focusedSession: vi.fn(),
  latestSession: vi.fn(),
  acknowledge: vi.fn(),
  limits: vi.fn(async () => limits),
  context: vi.fn(() => undefined),
  refresh: vi.fn(async () => undefined),
  invalidate: vi.fn(),
  close: vi.fn(),
};

vi.mock("../src/lib/providers/registry.js", () => ({
  activeProvider: () => provider,
  applyConfiguredProvider: () => ({ id: "codex" }),
}));

const { StreamDockKeys, keyKindOf } =
  await import("../src/surfaces/streamdock/keys.js");

class FakeSocket implements StreamDockSocket {
  readonly sent: string[] = [];
  readonly #handlers = new Map<string, ((...args: never[]) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }
  on(event: string, handler: (...args: never[]) => void): void {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), handler]);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      (handler as (...values: unknown[]) => void)(...args);
    }
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map(
      (frame) => JSON.parse(frame) as Record<string, unknown>,
    );
  }
}

const ARGS = [
  "node",
  "index.js",
  "-port",
  "28196",
  "-pluginUUID",
  "plugin-uuid",
  "-registerEvent",
  "registerPlugin",
  "-info",
  '{"application":{"language":"en"}}',
];

describe("Stream Dock launch arguments", () => {
  it("reads the flags the host passes", () => {
    expect(parseLaunchArgs(ARGS)).toEqual({
      port: 28196,
      uuid: "plugin-uuid",
      registerEvent: "registerPlugin",
      info: { application: { language: "en" } },
    });
  });

  it("falls back to the fixed positions the reference SDK indexes", () => {
    const positional = [
      "node",
      "index.js",
      "?",
      "5000",
      "?",
      "uuid",
      "?",
      "register",
      "?",
      "{}",
    ];
    expect(parseLaunchArgs(positional)).toMatchObject({
      port: 5000,
      uuid: "uuid",
      registerEvent: "register",
    });
  });

  it("tolerates unparseable info rather than refusing to start", () => {
    const argv = [...ARGS];
    argv[9] = "not json";
    expect(parseLaunchArgs(argv).info).toEqual({});
  });

  it("refuses to start without a usable port or identity", () => {
    expect(() => parseLaunchArgs(["node", "index.js"])).toThrow(/port/i);
    expect(() => parseLaunchArgs(["node", "index.js", "-port", "123"])).toThrow(
      /UUID/i,
    );
  });
});

describe("Stream Dock host", () => {
  let socket: FakeSocket;
  let host: StreamDockHost;

  beforeEach(() => {
    socket = new FakeSocket();
    host = new StreamDockHost(socket, parseLaunchArgs(ARGS));
  });

  it("registers with the uuid and event the host supplied", () => {
    socket.emit("open");
    expect(socket.frames()[0]).toEqual({
      uuid: "plugin-uuid",
      event: "registerPlugin",
    });
  });

  it("sends setImage in the frame shape Stream Dock expects", () => {
    host.setImage("ctx", "data:image/svg+xml;base64,AAA");
    expect(socket.frames()[0]).toEqual({
      event: "setImage",
      context: "ctx",
      payload: { target: 0, image: "data:image/svg+xml;base64,AAA" },
    });
  });

  it("routes an event to every handler registered for it", () => {
    const seen: string[] = [];
    host.on("keyUp", ({ context }) => void seen.push(`a:${context}`));
    host.on("keyUp", ({ context }) => void seen.push(`b:${context}`));
    socket.emit("message", JSON.stringify({ event: "keyUp", context: "ctx" }));
    expect(seen).toEqual(["a:ctx", "b:ctx"]);
  });

  it("ignores frames that are not JSON or carry no event", () => {
    const seen: string[] = [];
    host.on("keyUp", () => void seen.push("called"));
    socket.emit("message", "not json");
    socket.emit("message", JSON.stringify({ context: "ctx" }));
    expect(seen).toEqual([]);
  });

  it("reports a throwing handler instead of letting it escape", () => {
    const errors: unknown[] = [];
    const guardedSocket = new FakeSocket();
    const guarded = new StreamDockHost(
      guardedSocket,
      parseLaunchArgs(ARGS),
      (error) => errors.push(error),
    );
    guarded.on("keyUp", () => {
      throw new Error("handler exploded");
    });
    expect(() =>
      guardedSocket.emit("message", JSON.stringify({ event: "keyUp" })),
    ).not.toThrow();
    expect(String(errors[0])).toMatch(/handler exploded/);
  });

  it("reports a rejected async handler through the same channel", async () => {
    const errors: unknown[] = [];
    const guardedSocket = new FakeSocket();
    const guarded = new StreamDockHost(
      guardedSocket,
      parseLaunchArgs(ARGS),
      (error) => errors.push(error),
    );
    guarded.on("keyUp", async () => {
      throw new Error("async exploded");
    });
    guardedSocket.emit("message", JSON.stringify({ event: "keyUp" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(String(errors[0])).toMatch(/async exploded/);
  });

  it("adapts a key context to the shared render cache interface", async () => {
    const target = keyRenderTarget(host, "ctx");
    await target.setImage("image");
    await target.setTitle("");
    expect(socket.frames().map((frame) => frame["event"])).toEqual([
      "setImage",
      "setTitle",
    ]);
  });
});

describe("Stream Dock keys", () => {
  let socket: FakeSocket;
  let host: StreamDockHost;
  let keys: InstanceType<typeof StreamDockKeys>;

  const appear = (action: string, context: string, settings = {}): void => {
    socket.emit(
      "message",
      JSON.stringify({
        event: "willAppear",
        action,
        context,
        payload: { settings },
      }),
    );
  };

  const flush = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    vi.clearAllMocks();
    socket = new FakeSocket();
    host = new StreamDockHost(socket, parseLaunchArgs(ARGS));
    keys = new StreamDockKeys(host);
  });

  it("recognizes only its own action ids", () => {
    expect(keyKindOf("com.todd.streamdockcodex.quota")).toBe("quota");
    expect(keyKindOf("com.todd.streamdockcodex.agent")).toBe("agent");
    expect(keyKindOf("com.todd.streamdockcodex.context")).toBe("context");
    expect(keyKindOf("com.example.other.thing")).toBe(undefined);
  });

  it("draws a key as soon as it appears", async () => {
    appear("com.todd.streamdockcodex.quota", "ctx-quota");
    await flush();
    const images = socket
      .frames()
      .filter((frame) => frame["event"] === "setImage");
    expect(images).toHaveLength(1);
    expect(String((images[0]?.["payload"] as { image: string }).image)).toMatch(
      /^data:image\/svg\+xml/,
    );
  });

  it("ignores an action it does not own", async () => {
    appear("com.example.other.thing", "ctx-other");
    await flush();
    expect(keys.visibleContexts).toEqual([]);
  });

  it("forgets a key when it disappears", async () => {
    appear("com.todd.streamdockcodex.quota", "ctx-quota");
    await flush();
    expect(keys.visibleContexts).toEqual(["ctx-quota"]);
    socket.emit(
      "message",
      JSON.stringify({ event: "willDisappear", context: "ctx-quota" }),
    );
    expect(keys.visibleContexts).toEqual([]);
  });

  it("cycles the quota key through published windows on press", async () => {
    appear("com.todd.streamdockcodex.quota", "ctx-quota");
    await flush();
    const first = socket.sent.length;

    socket.emit(
      "message",
      JSON.stringify({ event: "keyUp", context: "ctx-quota" }),
    );
    await flush();
    const images = socket
      .frames()
      .slice(first)
      .filter((frame) => frame["event"] === "setImage");
    expect(images).toHaveLength(1);
    expect(
      String((images[0]?.["payload"] as { image: string }).image),
    ).not.toBe("");
  });

  it("acknowledges the slot's session when an agent key is pressed", async () => {
    appear("com.todd.streamdockcodex.agent", "ctx-agent", { slot: 0 });
    await flush();
    socket.emit(
      "message",
      JSON.stringify({ event: "keyUp", context: "ctx-agent" }),
    );
    await flush();
    expect(provider.acknowledge).toHaveBeenCalledWith("thread-1");
    expect(socket.frames().some((frame) => frame["event"] === "showOk")).toBe(
      true,
    );
  });

  it("alerts rather than acknowledging when the slot is empty", async () => {
    appear("com.todd.streamdockcodex.agent", "ctx-agent", { slot: 5 });
    await flush();
    socket.emit(
      "message",
      JSON.stringify({ event: "keyUp", context: "ctx-agent" }),
    );
    await flush();
    expect(provider.acknowledge).not.toHaveBeenCalled();
    expect(
      socket.frames().some((frame) => frame["event"] === "showAlert"),
    ).toBe(true);
  });

  it("reads the slot from settings whether it arrives as a number or a string", async () => {
    appear("com.todd.streamdockcodex.agent", "ctx-a", { slot: "0" });
    await flush();
    socket.emit(
      "message",
      JSON.stringify({ event: "keyUp", context: "ctx-a" }),
    );
    await flush();
    expect(provider.acknowledge).toHaveBeenCalledWith("thread-1");
  });

  it("redraws every visible key on refresh", async () => {
    appear("com.todd.streamdockcodex.quota", "ctx-quota");
    appear("com.todd.streamdockcodex.context", "ctx-context");
    await flush();
    const before = socket.sent.length;
    await keys.drawAll();
    expect(keys.visibleContexts).toHaveLength(2);
    expect(socket.sent.length).toBeGreaterThanOrEqual(before);
  });
});
