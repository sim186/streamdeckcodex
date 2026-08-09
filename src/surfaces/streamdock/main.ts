import WebSocket from "ws";
import { createRefreshCoordinator } from "../../lib/refresh-coordinator.js";
import {
  activeProvider,
  applyConfiguredProvider,
} from "../../lib/providers/registry.js";
import { StreamDockKeys } from "./keys.js";
import { parseLaunchArgs, StreamDockHost } from "./protocol.js";

/**
 * Entry point for the Stream Dock build.
 *
 * Stream Dock launches this file with the Node runtime it bundles, passing the
 * same `-port/-pluginUUID/-registerEvent/-info` arguments Elgato's original
 * SDK used. Everything below the transport — providers, renderers, the refresh
 * coordinator — is shared with the Elgato surface.
 */
const args = parseLaunchArgs(process.argv);
const socket = new WebSocket(`ws://127.0.0.1:${args.port}`);

const host = new StreamDockHost(socket, args, (error) => {
  process.stderr.write(`Stream Dock handler failed: ${String(error)}\n`);
});

const selected = applyConfiguredProvider();
if (selected.error) process.stderr.write(`${selected.error}\n`);
process.stderr.write(`Driving agent backend: ${activeProvider().label}\n`);

const keys = new StreamDockKeys(host);

const refresh = createRefreshCoordinator(
  async () => {
    await activeProvider().refresh();
    await keys.drawAll();
  },
  1250,
  (error) => {
    process.stderr.write(`Stream Dock refresh failed: ${String(error)}\n`);
  },
);

socket.on("error", (error: unknown) => {
  // The host owns the socket's lifetime. Report and let the close handler stop
  // the refresh loop rather than dying on an unhandled 'error' event.
  process.stderr.write(`Stream Dock socket error: ${String(error)}\n`);
});
socket.on("open", () => {
  refresh.start();
  void refresh.runNow();
});
socket.on("close", () => {
  refresh.stop();
  activeProvider().close();
  process.exit(0);
});

process.once("exit", () => {
  refresh.stop();
  activeProvider().close();
});
