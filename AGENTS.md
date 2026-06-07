# AGENTS.md

Guidance for AI agents working on this repository.

## What this is

A Pebble watchapp that shows [Plain](https://plain.com) support threads with
status `TODO` on the watch. The watch-side UI is native Pebble C with one
custom drawing layer, fixed-size buffers, native AppMessage parsing, button
navigation, and an `AppTimer` marquee. The phone-side companion (PebbleKit JS)
talks to the Plain GraphQL API and relays compact payloads to the watch.

Targets modern Pebble hardware only: **emery** (Pebble Time 2) and **gabbro**
(Pebble Round 2).

## Layout

```
src/c/mdbl.c                   Native watch UI, navigation, AppMessage parsing, marquee.
src/pkjs/index.js              PebbleKit JS entry point (phone side). Wires events, AppMessage.
src/pkjs/plain.js              Plain GraphQL client (queries, response shaping, error handling)
src/pkjs/settings.js           API key storage in phone localStorage
src/pkjs/config.js             Clay config page definition (API key entry)
package.json                   Pebble metadata: UUID, target platforms, messageKeys, resources
wscript                        waf build rules — usually no need to edit
build/                         Build output (generated, ignore)
docs/                          Markdown documentation notes from development
```

## Build, run, develop

Requires the `pebble` CLI (Rebble/Core Devices pebble-tool, installed via uv).

```sh
pebble build                          # build for all targetPlatforms
pnpm pebble:dev                       # build + install on emery emulator with logs
pnpm pebble:config                    # open the Clay config page for the emulator (opens Chrome)
pnpm pebble:install-mobile            # install to phone at hardcoded IP (see package.json)
pebble install --emulator emery --logs
```

There are no tests and no linter configured. Verify changes by building and
running in the emulator. Use **emery** as the primary emulator target.

When taking screenshots, wait a bit after launching the emulator. If the
launcher is shown instead of the app, press right/select a few times to launch
the `Plain` app before capturing the screenshot.

You can find the Pebble SDK docs at: https://developer.repebble.com/docs/

You should double check there first if you're unsure about anything.

## Architecture & data flow

1. **Phone (pkjs)** — on `ready`, `index.js` fetches up to 10 TODO threads from
   the Plain GraphQL API (`plain.js`, endpoint `core-api.uk.plain.com`) using
   the API key stored in phone localStorage (`settings.js`).
2. Threads are serialized into a single string payload using ASCII separators:
   `\x1f` (FIELD_SEPARATOR) between fields, `\x1e` (RECORD_SEPARATOR) between
   records. Sent to the watch under the `THREADS` message key.
3. **Watch (C)** — `src/c/mdbl.c` parses the payload into fixed-size buffers,
   renders a 5-row list with a header, and handles native button navigation.
   Select sends `THREAD_ID` (the list *index*, not the Plain thread ID) back to
   the phone.
4. Phone resolves index → thread ID via the in-memory `threadIds` array,
   fetches detail, replies with `THREAD_DETAIL` (or `THREAD_DETAIL_ERROR`).
5. Watch renders detail lines (key/value pairs), with marquee scrolling for the
   selected line.

### Message keys

Declared in `package.json` under `pebble.messageKeys` and exposed to C through
the generated `message_keys.auto.h` header. Keep `package.json`, C message-key
usage, and PKJS payload names in sync when adding/removing keys: `THREADS`,
`THREAD_ID`, `THREAD_DETAIL`, `THREAD_DETAIL_ERROR`, `ERROR`,
`PLAIN_API_KEY`, `CLEAR_API_KEY`.

## Constraints & gotchas

- **Tiny memory budget on the watch.** The native C app opens AppMessage with
  `INBOX_SIZE = 2048` and `OUTBOX_SIZE = 128`, and stores parsed data in
  fixed-size static arrays. Keep watch payloads compact: text is shortened
  phone-side (`messageText`, `shorten`) and sanitized to printable ASCII before
  sending (`[^\x20-\x7e]` replaced with `?`).
- **Payloads are flat strings, not structured objects.** Any new data must fit
  the separator-based encoding. Never emit raw `\x1e`/`\x1f` inside field text
  (pkjs strips them).
- **`THREAD_ID` is a list index.** Thread selection expires if the list is
  refetched; the phone side guards against stale indices.
- **API key never goes to the watch.** It lives in phone localStorage only.
  `settings.scrubClaySecrets()` removes it from Clay's persisted settings so it
  doesn't leak into the config page roundtrip. Preserve this behavior.
- **pkjs runs in the phone's JS sandbox** — use `XMLHttpRequest` (no fetch),
  CommonJS `require`, and defensive `typeof console` checks.
- **The watch UI is native C** — avoid heap-heavy patterns. Prefer fixed-size
  static buffers, bounded copies, one custom drawing layer, and explicit
  AppMessage parsing.
- **The watch list UI is 5 fixed rows**, not a virtual list. Scrolling works by
  shifting `s_first_visible_index` / `s_detail_offset`.
- **Round display (gabbro)** is a target platform; avoid layout assumptions
  that only hold for rectangular screens. Primary target platform is **emery**.
- **documentation** When writing any notes or docs, always write them into the
  docs/ directory and date your markdown files by prefixing them with todays
  date in the format of YYYY-MM-DD, i.e. '2026-06-23-http-client-fixes.md'.
- **pnpm** We always use 'pnpm' as the root package manager. NEVER use 'npm'

## Configuration

App settings use [Clay](https://github.com/pebble/clay) (`config.js`). The only
setting is the Plain API key (machine user key, `plainApiKey_...`). For the
emulator, `pnpm pebble:config` opens the generated config page in Chrome
(Clay pages crash Vivaldi — keep the `BROWSER='open -a "Google Chrome" %s'`
override in package.json).

## Plain API notes

- GraphQL endpoint: `https://core-api.uk.plain.com/graphql/v1`, header
  `authorization: Bearer <apiKey>`.
- Thread list: `threads(filters: { statuses: [TODO] }, first: 10)`.
- Thread detail includes customer, labels, assignee, priority, and the last 5
  message timeline entries; each timeline entry type has its own text-field
  shape — see `entryText()` in `plain.js` before touching the query.
