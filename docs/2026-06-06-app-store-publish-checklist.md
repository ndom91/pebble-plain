# App Store Publish Checklist

## Package Metadata

- App name: `Plain`
- Package name: `plain-pebble`
- Version: `1.0.0`
- Type: watchapp, not watchface
- Target platforms: `emery`, `gabbro`
- Capabilities: configurable
- Category: productivity

Before making the repository public, choose and add a license. Do not publish
with an accidental implied license.

## Listing Copy

Short description:

```text
View Plain TODO support threads on your Pebble.
```

Long description:

```text
Plain for Pebble shows your Plain TODO support threads on the watch, including thread references, titles, customer metadata, labels, assignees, and recent messages.

Requires a Plain machine-user API key. Configure the key from the Pebble/Rebble phone app settings page. The API key is stored on the phone by PebbleKit JS and is not sent to the watch.

Supported watches: Pebble Time 2 and Pebble Round 2.
```

Release notes:

```text
Initial public release. Shows Plain TODO threads, thread details, and recent messages with native Pebble navigation and phone-side API-key configuration.
```

## Assets

- Menu icon: `resources/images/menu-icon.png`
- Store icon source: `assets/icon.png`
- Store small icon: `assets/store-icon-small.png`
- Store large icon: `assets/store-icon-large.png`
- Store screenshots: capture at least one `emery_*.png`; add `gabbro_*.png` if using `--all-platforms` or uploading screenshots manually.

Set `--source` to the public repository URL after the repository exists.

## Preflight

```sh
pebble clean
pebble build
pebble install --emulator emery
pebble install --emulator gabbro
```

## Publish Command

Interactive upload:

```sh
pebble login
pebble publish \
  --release-notes "Initial public release. Shows Plain TODO threads, thread details, and recent messages with native Pebble navigation and phone-side API-key configuration."
```

Non-interactive upload template:

```sh
pebble publish --non-interactive \
  --name "Plain" \
  --version "1.0.0" \
  --description "Plain for Pebble shows your Plain TODO support threads on the watch, including thread references, titles, customer metadata, labels, assignees, and recent messages. Requires a Plain machine-user API key configured from the Pebble/Rebble phone app. The API key is stored on the phone and is not sent to the watch." \
  --category productivity \
  --source "<public-repository-url>" \
  --icon-small assets/store-icon-small.png \
  --icon-large assets/store-icon-large.png \
  --screenshots "<emery_screenshot.png>" \
  --release-notes "Initial public release. Shows Plain TODO threads, thread details, and recent messages with native Pebble navigation and phone-side API-key configuration."
```

Use `--is-published` only when the listing should become visible immediately.
