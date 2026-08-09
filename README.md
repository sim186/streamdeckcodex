# Stream Deck Codex Companion

[![CI](https://github.com/twidtwid/streamdeckcodex/actions/workflows/ci.yml/badge.svg)](https://github.com/twidtwid/streamdeckcodex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local Stream Deck controls for the Codex desktop app on macOS. It provides live
chat status, commands, workflows, approval mode, usage, and context on keys.
Each supported Stream Deck family gets a layout sized for its physical keys.
Stream Deck + also gets four live dials.

This is an unofficial community project. It is not affiliated with or endorsed
by OpenAI, Work Louder, Elgato, or Corsair, and it includes no proprietary
OpenAI artwork or source.

![Stream Deck Codex Companion running on a Stream Deck +](assets/hardware/stream-deck-plus.jpg)

> **Beta:** the Stream Deck + experience is hardware-tested. The Stream Deck,
> Mini, Neo, and XL profiles pass automated and Elgato validation; their first
> independent hardware test is still in progress.

## Install from GitHub

Requirements:

- macOS 13 or newer
- [Codex desktop](https://openai.com/codex/) installed and signed in
- Stream Deck 7.1 or newer
- Stream Deck, Stream Deck Mini, Stream Deck Neo, Stream Deck XL, or Stream
  Deck +; dials require Stream Deck +

1. Open the repository's
   [Releases](https://github.com/twidtwid/streamdeckcodex/releases) page.
2. Download `com.todd.streamdeckcodex.streamDeckPlugin` from the newest release.
3. Double-click the downloaded file and approve installation in Stream Deck.
4. Open Codex and select a chat.
5. Grant **Stream Deck** Accessibility permission in
   **System Settings → Privacy & Security → Accessibility**.

No API key, account token, background service, or separate Codex CLI
installation is required.

### Included profiles

The editable profile for the connected model should install automatically.
Every layout starts with Live Controls, followed by Agents & Sessions, then the
workflow pages. Mini splits sections across additional pages to fit its six
keys without dropping actions.

If no profile appears, download and open the matching release asset:

| Hardware         | Manual profile asset                            |
| ---------------- | ----------------------------------------------- |
| Stream Deck      | `streamdeckcodex-stream-deck.streamDeckProfile` |
| Stream Deck Mini | `streamdeckcodex-mini.streamDeckProfile`        |
| Stream Deck Neo  | `streamdeckcodex-neo.streamDeckProfile`         |
| Stream Deck XL   | `streamdeckcodex-xl.streamDeckProfile`          |
| Stream Deck +    | `streamdeckcodex-plus.streamDeckProfile`        |

The first page contains FAST, Permissions, PTT, Quota, YEET, New Project,
Compact, and Context. Agents & Sessions contains six live chat slots, New Chat,
and Plan. The remaining sections are Git & Delivery, Code Quality, Decisions,
Workspace, and Codex Panels.

Reinstalling a profile creates another copy instead of overwriting personal
changes. Remove an older test copy in Stream Deck's Profiles settings if you no
longer need it.

All 50 key actions are present on every button-only profile. Model, Reasoning
Effort, and Agent Navigator are dial-only; the key experience does not depend
on them. Hold PTT while speaking and release the key to stop.

Please include the exact Stream Deck model, macOS version, Stream Deck version,
Codex version, and the failing action when
[reporting a beta issue](https://github.com/twidtwid/streamdeckcodex/issues/new?template=bug_report.yml).

## What it does

- Shows six recent Codex chats with live idle, running, unread, needs-input,
  error, and focused states.
- Opens the exact chat represented by a key or dial.
- Toggles FAST and Plan only after verifying the visible Codex result.
- Cycles the focused chat's real permission choices: Ask, Approve, YOLO, and
  Custom. Entering YOLO handles Codex's Full Access confirmation and verifies
  the result.
- Provides guarded push-to-talk, New Chat, New Project, Compact, Review,
  Browser, Files, Side chat, Settings, and other Codex commands.
- Launches named PR review, debugging, refactoring, testing, Git, and code
  workflows in the focused workspace.
- Displays weekly quota, banked resets, and focused-chat context from local
  Codex data.
- On Stream Deck +, previews and applies Model and Reasoning selections with
  live dial feedback.

### Mirabox Stream Dock (experimental, untested on hardware)

A second build targets Mirabox Stream Dock devices. Stream Dock's plugin host
reuses the command line, WebSocket registration, and event vocabulary of
Elgato's original SDK, and bundles its own Node runtime, so the providers,
renderers, and refresh loop are shared with the Elgato build and only the
transport differs.

```sh
npm run build:streamdock   # → com.todd.streamdockcodex.sdPlugin/plugin/index.js
```

Copy `com.todd.streamdockcodex.sdPlugin` into Stream Dock's plugin directory,
then place the Agent Chat, Quota, and Context keys yourself. Set each Agent
Chat key's `slot` to choose which recent chat it shows.

Known constraints, all confirmed against Mirabox's published SDK:

- **No bundled profiles.** Stream Dock has no profile-installation mechanism,
  so there is no equivalent of the auto-installed Elgato layouts. Keys are
  placed by hand.
- **Node 20.** Stream Dock bundles an older runtime than the Elgato app, so
  this build targets Node 20 and `node:sqlite` is loaded only when the Codex
  backend first reads. A host whose runtime predates `node:sqlite` can still
  run the Claude Code backend.
- **Keys only.** Model, Reasoning, and Agent Navigator remain dial-only and are
  not part of this build; knob-equipped Stream Dock models are not addressed.
- **Untested on hardware.** Everything here is verified by unit tests against
  the documented protocol. It has never run on a physical Stream Dock.

### Agent backends

The companion drives Codex by default. A second backend, Claude Code, reads
local session transcripts; select it by setting `STREAMDECK_AGENT=claude-code`
in the Stream Deck App's environment before the plugin starts. An unknown name
is logged and ignored, leaving Codex active.

Backends declare what they can do, and keys hide controls the active backend
cannot honour:

| Control                   | Codex | Claude Code |
| ------------------------- | ----- | ----------- |
| Chats, status, and unread | Yes   | Yes         |
| Usage limits              | Yes   | Estimated   |
| Context                   | Yes   | Yes         |
| Model and Reasoning       | Yes   | No          |
| Permissions               | Yes   | No          |

Claude Code exposes no programmatic model switch, reasoning selector, or
permission control, so those keys are unavailable while it is active. Its
"focused" chat means the most recently active transcript, because the CLI runs
in a terminal the plugin cannot inspect.

### Usage limits

The Quota key cycles every limit window the active backend publishes, then any
banked balance. Codex offers 5-hour, weekly, and banked resets; a
dollar-metered subscription would offer its own windows and balance through the
same key.

Values are rendered in the unit the vendor meters: a percentage where the
vendor reports one, a currency amount where it publishes a cash cap, and raw
token consumption where it publishes no cap at all. A figure the companion
inferred rather than read is prefixed with `~` and is never presented as
vendor-confirmed.

Anthropic publishes no programmatic read of Claude Code account limits, so
those windows are reconstructed from local transcripts and always marked as
estimates. No token cap is published either, so the key shows tokens consumed
rather than a percentage of an unknown allowance. Supply your own caps to get a
percentage instead:

| Variable                                | Effect                          |
| --------------------------------------- | ------------------------------- |
| `STREAMDECK_CLAUDE_5H_TOKEN_BUDGET`     | Token cap for the 5-hour window |
| `STREAMDECK_CLAUDE_WEEKLY_TOKEN_BUDGET` | Token cap for the weekly window |

### Live status colors

| State                       | Color     |
| --------------------------- | --------- |
| Idle                        | `#FFFFFF` |
| Unread completion           | `#9BF396` |
| Thinking or running         | `#9CD5FE` |
| Approval or answer required | `#FFD0B8` |
| Error                       | `#FF7373` |
| Empty slot                  | Off       |

### Stream Deck + dials

| Dial      | Turn                          | Press                     |
| --------- | ----------------------------- | ------------------------- |
| Agent     | Browse recent chats           | Open selected chat        |
| Action    | Select a curated Codex action | Run the displayed action  |
| Model     | Preview Luna, Terra, or Sol   | Apply the displayed model |
| Reasoning | Preview a supported level     | Apply the displayed level |

Touch-strip taps and holds are intentionally inert so a page swipe cannot run a
command accidentally.

## macOS Accessibility

Commands that operate Codex's visible UI need Accessibility permission for the
Stream Deck App. The native helper has a fixed allow-list; it cannot execute an
arbitrary shell command.

Plan, FAST, Model, Reasoning, and Permissions reread the visible Codex control
before reporting success. If Codex changes focus, contains a draft where that
would be unsafe, or does not expose the expected control, the action fails
closed and displays an alert.

Push-to-talk is guarded by a watchdog. Releasing the key, leaving the page,
stopping the plugin, losing the parent process, a partial key-down failure, or
the 60-second maximum hold releases every synthesized modifier.

## Privacy and security

The plugin runs locally and:

- opens Codex's local SQLite index read-only with `PRAGMA query_only`;
- reads bounded tails of recent Codex rollout and desktop-log files;
- uses the Codex App's bundled local app-server for account limits and model
  metadata;
- uses documented `codex://` links and user-authorized macOS UI automation;
- never writes Codex's SQLite database, rollouts, config, or App files;
- has no analytics, telemetry, independent network service, credential prompt,
  or direct credential access.

The plugin package is immutable at runtime and does not read its own manifest,
which keeps it compatible with Elgato Marketplace DRM packaging.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Troubleshooting

### A key displays an alert or does nothing

1. Confirm Codex is open with a chat selected.
2. Confirm Stream Deck is enabled under macOS Accessibility.
3. Clear any unsent draft before using Plan or FAST.
4. Press the key again while the intended Codex window is visible.

The plugin refuses ambiguous focus instead of sending input to another chat.

### Permissions says Unknown

Open the intended Codex chat and send or receive one message so Codex has an
active composer, then press Permissions again. The key reads the visible
composer; it does not guess from saved configuration.

### No profile appeared

Open the matching `.streamDeckProfile` release asset from the table above. If
the model-specific profile still does not appear, confirm the Stream Deck App
recognizes the device, then include its exact model in a beta bug report.

### Usage or Context shows no data

Usage needs a working signed-in Codex App session. Context needs a recent token
snapshot from the focused chat. Both display no data rather than borrowing a
value from another chat.

### Reporting a bug

Use the [bug report
template](https://github.com/twidtwid/streamdeckcodex/issues/new?template=bug_report.yml).
Do not attach Codex transcripts, rollout files, credentials, or private paths.

## Known limitations

- Codex does not publish a stable desktop command API for every action, so some
  controls depend on documented shortcuts and visible accessibility labels.
- A Codex UI or local-schema update can require a companion update; failures
  are explicit and never shown as successful.
- Accept and Reject act on the currently visible approval or question. Read the
  request in Codex before accepting it.
- Unread acknowledgement is companion-local and resets when the plugin process
  is replaced.
- Stream Deck preserves customized profiles during plugin upgrades; profiles
  do not auto-update in place.

## Build from source

Development requires Node.js 24, librsvg, and ImageMagick.

```sh
git clone https://github.com/twidtwid/streamdeckcodex.git
cd streamdeckcodex
npm ci
npm run check
npm run link
```

Useful commands:

```sh
npm run check       # formatting, types, tests, visual QA, build, validation
npm run pack        # create dist/com.todd.streamdeckcodex.streamDeckPlugin
npm run qa:design   # render and evaluate every profile key
```

The connected mutation gate is intentionally separate from CI and fails closed
unless it can prove a disposable fixture, exact foreground chat, empty
composer, and cleanup. See [QA.md](QA.md) before running connected QA.

## Release checklist

```sh
npm ci
npm run check
npm audit --omit=dev
npm run pack
```

The release should contain:

- `com.todd.streamdeckcodex.streamDeckPlugin`
- `streamdeckcodex-stream-deck.streamDeckProfile`
- `streamdeckcodex-mini.streamDeckProfile`
- `streamdeckcodex-neo.streamDeckProfile`
- `streamdeckcodex-xl.streamDeckProfile`
- `streamdeckcodex-plus.streamDeckProfile`
- release notes naming supported macOS, Stream Deck, and Codex versions

The package includes this project's MIT license and complete license texts for
bundled runtime dependencies. Elgato's CLI validates the manifest and package
before creating the installer.

## Attribution

Every redistributable pictogram is generated from
[Lucide](https://lucide.dev/). YEET is an original outlined wordmark generated
from the open-licensed Barlow Condensed Black Italic font. No installed
ChatGPT/Codex or Codex Micro artwork is embedded.

Implementation research included the official
[Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/),
[Marketplace plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/),
and public open-source Stream Deck integrations listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The current requirement-by-requirement release audit is in
[MARKETPLACE.md](MARKETPLACE.md).

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) first.
