#!/usr/bin/env bash

set -euo pipefail

read_package_json() {
  node -p "const p = require('./package.json'); $1"
}

APP_NAME="${APP_NAME:-$(read_package_json "p.pebble.displayName")}"
APP_VERSION="${APP_VERSION:-$(read_package_json "p.version")}"
APP_DESCRIPTION="${APP_DESCRIPTION:-Plain for Pebble shows your Plain TODO support threads on the watch, including thread references, titles, customer metadata, labels, assignees, and recent messages. Requires a Plain machine-user API key configured from the Pebble/Rebble phone app. The API key is stored on the phone and is not sent to the watch.}"
APP_CATEGORY="${APP_CATEGORY:-tools}"
SOURCE_URL="${SOURCE_URL:-$(read_package_json "p.repository && p.repository.url || ''")}"
RELEASE_NOTES="${RELEASE_NOTES:-Initial public release. Shows Plain TODO threads, thread details, and recent messages with native Pebble navigation and phone-side API-key configuration.}"

if [ -z "$SOURCE_URL" ]; then
  printf 'SOURCE_URL is required, for example:\n  SOURCE_URL=https://github.com/<owner>/<repo> %s screenshots/emery.png\n' "$0" >&2
  exit 1
fi

case "$APP_CATEGORY" in
  daily|tools|notifications|remotes|health|games) ;;
  *)
    printf 'Invalid APP_CATEGORY: %s\nValid categories: daily, tools, notifications, remotes, health, games\n' "$APP_CATEGORY" >&2
    exit 1
    ;;
esac

if [ "$#" -gt 0 ]; then
  screenshots=("$@")
else
  shopt -s nullglob
  screenshots=(screenshots/*.png screenshots/*.gif)
  shopt -u nullglob
fi

if [ "${#screenshots[@]}" -eq 0 ]; then
  printf 'No screenshots found. Add PNG or GIF files to screenshots/, or pass screenshot paths explicitly.\n' >&2
  exit 1
fi

for screenshot in "${screenshots[@]}"; do
  if [ ! -f "$screenshot" ]; then
    printf 'Screenshot does not exist: %s\n' "$screenshot" >&2
    exit 1
  fi
done

pebble publish --non-interactive \
  --name "$APP_NAME" \
  --version "$APP_VERSION" \
  --description "$APP_DESCRIPTION" \
  --category "$APP_CATEGORY" \
  --source "$SOURCE_URL" \
  --icon-small assets/store-icon-small.png \
  --icon-large assets/store-icon-large.png \
  --screenshots "${screenshots[@]}" \
  --release-notes "$RELEASE_NOTES"
