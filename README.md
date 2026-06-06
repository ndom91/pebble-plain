# Plain Pebble Watchapp

A Pebble watchapp that shows Plain TODO support threads on the watch.

The watch UI is native Pebble C. The phone companion is PebbleKit JS and owns
Plain GraphQL requests, Clay configuration, and API-key storage. The watch and
phone exchange compact AppMessage strings using record and field separators.

## Building & running

```sh
pebble build                          # build for all targetPlatforms
pebble install --emulator emery --logs # install on the emery emulator
pebble install --phone <ip>           # install to a paired phone
```

## Target platforms

The app targets modern Pebble hardware: **emery** (Pebble Time 2) and
**gabbro** (Pebble Round 2). Other platforms are currently not supported.

## Project layout

```
src/c/mdbl.c                   Native watch UI, navigation, AppMessage parsing
src/pkjs/index.js              PebbleKit JS orchestration and payload sending
src/pkjs/plain.js              Plain GraphQL client and response mapping
src/pkjs/settings.js           Phone-side API key storage
src/pkjs/config.js             Clay configuration page
package.json                   Project metadata (UUID, platforms, resources)
wscript                        Build rules — usually no need to edit
```

## Migration Notes

The watch UI used to run on Moddable/Piu. It was migrated to native C to avoid
startup heap pressure from the JavaScript runtime and Piu object tree. See
`docs/2026-06-06-migrate-to-c-plan.md` for the migration rationale and plan.

## Documentation

Full SDK docs and tutorials: <https://developer.repebble.com>
