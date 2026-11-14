#!/bin/sh
# Run ./start.sh to start Amber Terminal (Linux).
# First checks the repo for a newer version and installs it (SETTINGS > Updates, or REPO_URL= / BRANCH= in
# data/launcher.cfg; default https://github.com/hoermto/kamiterm.git, branch master). No git needed; data/ is
# never touched; a git checkout updates by git, fast-forward only. AMBER_UPDATE=0 ./start.sh skips the update.
# One { } block: sh reads it completely before running it, so an update that rewrites this file can't break it.
{
  cd "$(dirname "$0")" || exit 1
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22.13 or newer is needed (https://nodejs.org), then run ./start.sh again."
    exit 1
  fi
  if [ "${AMBER_UPDATE:-1}" != "0" ]; then
    node scripts/update.js --apply
  fi
  exec node server.js --open
}
