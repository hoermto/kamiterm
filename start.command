#!/bin/sh
# Double-click this on a Mac to start Amber Terminal.
# First checks the repo for a newer version and installs it, as start.sh does on Linux (see there).
# One { } block: sh reads it completely before running it, so an update that rewrites this file can't break it.
{
  cd "$(dirname "$0")" || exit 1
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22.13 or newer is needed (https://nodejs.org), then start this again."
    exit 1
  fi
  if [ "${AMBER_UPDATE:-1}" != "0" ]; then
    node scripts/update.js --apply
  fi
  exec node server.js --open
}
