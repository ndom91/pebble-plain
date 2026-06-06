# 2026-06-06 Watch-Side C Migration Plan

## Context

The current app works, but the watch-side Moddable/Piu implementation is already close to the Pebble heap limit. Recent feature work showed that small additions to the watch-side JavaScript, such as extra view state, extra labels, or an additional message path, can cause `fxAbort memory full` at startup even before any Plain data is loaded.

The deeper issue is not the Plain GraphQL payload itself. The startup pressure comes from running a Pebble watch UI through the Moddable XS runtime, Piu, Piu templates, styles, skins, and the Pebble proxy bridge. Native C Pebble apps avoid that runtime overhead, which is why more complex apps and games are feasible on the same hardware.

The migration goal is to move only the watch-side UI, navigation, state, and AppMessage handling to C. Phone-side JavaScript should remain responsible for Plain API access, GraphQL, Clay configuration, and API-key storage.

## Current Architecture

Watch-side:

- `src/embeddedjs/main.js` renders the watch UI with Moddable/Piu.
- `src/c/mdbl.c` only creates a Pebble window and starts the Moddable machine.
- `src/embeddedjs/manifest.json` builds the Moddable module.
- The app metadata currently uses `projectType: "moddable"`.

Phone-side:

- `src/pkjs/index.js` orchestrates Pebble events and AppMessage payloads.
- `src/pkjs/plain.js` performs Plain GraphQL requests and maps data.
- `src/pkjs/config.js` and `src/pkjs/settings.js` handle Clay and API-key storage.

Current watch protocol:

- `THREADS`: compact list payload.
- `THREAD_ID`: watch sends selected list index to phone.
- `THREAD_DETAIL`: compact detail payload.
- `THREAD_DETAIL_ERROR`: scoped detail error.
- `ERROR`: list/global error.

Current payload separators:

- Record separator: `\x1e`
- Field separator: `\x1f`

## Pebble C API Findings

The Pebble C SDK has direct APIs for every watch-side responsibility we currently implement in Piu.

Window and lifecycle:

- Docs: `https://developer.repebble.com/docs/c/User_Interface/Window/`
- Use `window_create`, `window_destroy`, `window_stack_push`, `window_set_window_handlers`, and `window_get_root_layer`.

Layers and custom drawing:

- Docs: `https://developer.repebble.com/docs/c/User_Interface/Layers/`
- Use `layer_create`, `layer_destroy`, `layer_add_child`, `layer_set_update_proc`, and `layer_mark_dirty`.
- A single custom drawing layer is likely better than multiple `TextLayer`s because it minimizes Pebble layer objects and gives precise control over row layout.

Text drawing:

- Docs: `https://developer.repebble.com/docs/c/Graphics/Drawing_Text/`
- Docs: `https://developer.repebble.com/docs/c/Graphics/Fonts/`
- Use `graphics_draw_text` and `fonts_get_system_font`.
- This allows key/value rows to be drawn as two separate text regions without creating two UI objects per row.

Buttons:

- Docs: `https://developer.repebble.com/docs/c/User_Interface/Clicks/`
- Use `window_set_click_config_provider`, `window_single_click_subscribe`, and `window_single_repeating_click_subscribe`.
- Up/down should repeat for list/detail scrolling.

AppMessage:

- Docs: `https://developer.repebble.com/docs/c/Foundation/AppMessage/`
- Docs: `https://developer.repebble.com/docs/c/Foundation/Dictionary/`
- Use `app_message_register_inbox_received`, `app_message_register_inbox_dropped`, `app_message_register_outbox_sent`, `app_message_register_outbox_failed`, and `app_message_open`.
- Use `app_message_outbox_begin`, `dict_write_cstring`, and `app_message_outbox_send` to send `THREAD_ID`.
- The current compact string protocol can be reused.

Timers:

- Docs: `https://developer.repebble.com/docs/c/Foundation/Timer/`
- Use `app_timer_register`, `app_timer_reschedule`, and `app_timer_cancel` for marquee animation.

## Recommended Target Architecture

Use native C for the entire watch-side application and keep PKJS for phone-side work.

Watch-side C should own:

- Window lifecycle.
- One custom canvas layer.
- Button handlers.
- List/detail state.
- Fixed-size parsed thread/detail buffers.
- AppMessage receive/send.
- Marquee timer.
- Manual drawing of header, selected row background, row key, and row value.

Phone-side JS should keep owning:

- Plain API requests.
- GraphQL query construction.
- GraphQL response mapping.
- Clay config page.
- API-key storage and scrubbing.
- Payload construction for `THREADS`, `THREAD_DETAIL`, `THREAD_DETAIL_ERROR`, and `ERROR`.

## Why Custom Drawing First

There are two possible C UI approaches.

Option A: Use `TextLayer`s.

- Easier initial implementation.
- Still creates multiple layer objects.
- Harder to draw selected backgrounds and key/value text precisely without extra layers.
- Better as a spike only if custom drawing proves unexpectedly slow.

Option B: Use one custom `Layer` with `graphics_draw_text`.

- Best memory profile.
- Best control over layout.
- Can draw two-line rows without two UI objects per row.
- Lets the selected value marquee be drawn exactly where needed.

Recommendation: use Option B immediately. The current application is simple enough that a custom draw function is manageable, and memory is the main constraint.

## Proposed Static Data Model

Avoid dynamic allocation in watch C. Use fixed-size arrays and bounded strings.

Suggested constants:

```c
#define MAX_THREADS 10
#define MAX_DETAIL_ROWS 12
#define REF_LEN 16
#define TITLE_LEN 72
#define DETAIL_KEY_LEN 16
#define DETAIL_VALUE_LEN 72
#define STATUS_LEN 48
#define INBOX_SIZE 1152
#define OUTBOX_SIZE 128
```

Suggested structs:

```c
typedef struct {
  char ref[REF_LEN];
  char title[TITLE_LEN];
} ThreadRow;

typedef struct {
  char key[DETAIL_KEY_LEN];
  char value[DETAIL_VALUE_LEN];
} DetailRow;

typedef enum {
  ViewList,
  ViewDetail,
} View;
```

Suggested state:

```c
static ThreadRow s_threads[MAX_THREADS];
static DetailRow s_detail_rows[MAX_DETAIL_ROWS];
static char s_status[STATUS_LEN];
static char s_parse_buffer[INBOX_SIZE];

static uint8_t s_thread_count;
static uint8_t s_detail_count;
static uint8_t s_selected_index;
static uint8_t s_first_visible_index;
static uint8_t s_detail_selected_index;
static uint8_t s_detail_offset;
static View s_view;
static uint8_t s_marquee_offset;
static AppTimer *s_marquee_timer;
```

## Rendering Plan

Use one custom root layer update proc.

Draw order:

1. Fill background.
2. Draw status/header text.
3. For each visible row, compute row frame.
4. If selected, fill row background with accent green.
5. In list view, draw `ref + " " + title` as one row line.
6. In detail view, draw key at the top of the row and value below it.
7. Apply marquee only to selected row value if it exceeds available width.

Initial fonts:

- Header/status: `FONT_KEY_GOTHIC_14_BOLD` or equivalent system font.
- List row: `FONT_KEY_GOTHIC_18_BOLD`.
- Detail key: `FONT_KEY_GOTHIC_14`.
- Detail value: `FONT_KEY_GOTHIC_18_BOLD` or `FONT_KEY_GOTHIC_18` depending on readability.

Initial colors:

- Background: black or current dark background equivalent.
- Header/status: accent green.
- Selected row background: accent green.
- Selected text: dark foreground.
- Unselected text: white or light gray.

## Migration Milestones

### Milestone 1: Native C Placeholder Shell

Goal:

- Replace the Moddable bootstrap with a native Pebble C app that starts and draws static placeholder rows.

Work:

- Replace `src/c/mdbl.c` with native app lifecycle.
- Create `Window` and one root custom `Layer`.
- Draw static status and rows in C.
- Wire basic up/down/select/back handlers against placeholder state.

Verification:

- `pebble clean && pebble build`
- `pebble install --emulator emery --logs`
- `pebble install --emulator gabbro --logs`
- Confirm no `moddable_createMachine` startup logs.
- Confirm no `memory full` faults.

### Milestone 2: Native AppMessage Receive

Goal:

- C watch receives the existing `THREADS`, `THREAD_DETAIL`, `THREAD_DETAIL_ERROR`, and `ERROR` messages.

Work:

- Register AppMessage callbacks.
- Open inbox/outbox with current safe sizes: `1152` and `128`.
- Parse compact string payloads into fixed arrays.
- Display list and detail data from parsed buffers.

Verification:

- Phone sends TODO list to native watch UI.
- Detail payload renders after selecting a row.
- Error states render correctly.
- No dropped payloads for current real data.

### Milestone 3: Native Watch Navigation

Goal:

- Match current watch behavior in C.

Work:

- Up/down scroll list and detail rows.
- Select in list sends `THREAD_ID` with selected index.
- Back in detail returns to list.
- Preserve current status strings.

Verification:

- List scroll works.
- Detail scroll works.
- Back/select behavior matches current JS behavior.

### Milestone 4: Native Key/Value Detail Rendering

Goal:

- Recreate the two-line detail row design with native drawing.

Work:

- Draw key and value into separate rectangles inside one row.
- Apply selected-row colors to both lines.
- Tune row height, key/value baselines, and fonts.
- Keep five visible rows if readable; reduce only if text readability requires it.

Verification:

- Visual alignment is better than current one-label Piu compromise.
- Long values still fit/marquee without clipping key labels.

### Milestone 5: Native Marquee Timer

Goal:

- Reimplement selected-row marquee in C.

Work:

- Register an `AppTimer` for the current marquee interval.
- Increment `s_marquee_offset` on timer callback.
- Mark the custom layer dirty.
- Reset marquee on selection/view changes.
- Cancel timer on app deinit.

Verification:

- Selected list title marquee works.
- Selected detail value marquee works.
- Static keys never marquee.
- Timer does not run unnecessarily when selected text fits.

### Milestone 6: Remove Moddable Project Wiring

Goal:

- Remove the Moddable runtime from the app package.

Work:

- Change package metadata away from `projectType: "moddable"` after confirming the native app bundles correctly.
- Remove `@moddable/pebbleproxy` dependency.
- Remove `src/embeddedjs/main.js` and `src/embeddedjs/manifest.json`.
- Simplify `src/pkjs/index.js` to use `Pebble.sendAppMessage` directly.
- Keep Clay and phone-side Plain modules.

Verification:

- Build no longer runs Moddable prebuild.
- PBW still includes phone-side JS.
- Clay configuration still opens and saves API key.
- Watch startup heap is no longer close to the current limit.

## Phone-Side JS Adjustments

Keep most PKJS logic intact. Only remove Moddable-specific glue once C AppMessage works.

Likely changes:

- Remove `const moddableProxy = require("@moddable/pebbleproxy")`.
- Remove `moddableProxy.readyReceived(e)`.
- Remove `moddableProxy.appMessageReceived(e)`.
- Remove conditional `moddableProxy.sendAppMessage` path.
- Use `Pebble.sendAppMessage(payload, success, failure)` directly.

Do not migrate these to C:

- Plain GraphQL.
- `XMLHttpRequest` network code.
- Clay configuration.
- API-key localStorage.
- GraphQL data mapping.

## Packaging Risk

The main unknown is package metadata. The current app declares `projectType: "moddable"`, which triggers the Moddable prebuild and resource injection. We need to confirm the correct native package shape that still supports multi-file PKJS and Clay.

Risk-reduction approach:

1. First replace `mdbl.c` with a native placeholder but leave package metadata unchanged only long enough to prove native C code can compile.
2. Then switch away from `projectType: "moddable"` in a separate commit/spike.
3. Verify that `build/pebble-js-app.js` still contains the PKJS bundle and that Clay config still works.

If package metadata becomes noisy, create a separate native branch or temporary test app to identify the smallest native Pebble package config before touching the working app.

## Implementation Priorities

Priority 1:

- Native C shell and custom draw layer.
- This removes the biggest source of startup heap pressure.

Priority 2:

- AppMessage receive and fixed-buffer parsing.
- This gives the native UI real data while preserving the current phone-side architecture.

Priority 3:

- Navigation and detail rendering parity.
- This gets feature parity with the current app.

Priority 4:

- Marquee.
- Useful, but safe to add after the static rendering path is stable.

Priority 5:

- Remove Moddable dependencies and cleanup phone-side bridge code.
- Do this after the native path is verified to avoid losing the working app during packaging experiments.

## Success Criteria

The migration is successful when:

- The watch app launches without `moddable_createMachine`.
- The watch UI is rendered entirely by C.
- Plain TODO list loads from phone-side JS.
- Selecting a thread fetches and renders detail rows.
- Back/select/up/down behavior matches the current app.
- Key/value detail rows look at least as good as the current Piu version.
- Selected value marquee works.
- Clay config and API-key storage still work.
- `pebble clean && pebble build` passes.
- `pebble install --emulator emery --logs` passes without `memory full`.
- `pebble install --emulator gabbro --logs` passes without `memory full`.

## Notes From Current App Behavior

- Startup runtime failures can occur even when build succeeds.
- Emulator connection failures are separate from app faults; confirm by looking for app logs such as `fxAbort memory full` or native crash output.
- The current detail row design is viable but constrained by one Piu label per row. Native custom drawing should improve this layout without increasing object count.
- The current compact delimiter protocol is a good fit for C because it avoids JSON parsing on the watch.
