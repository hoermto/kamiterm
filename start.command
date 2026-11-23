#!/bin/sh
# Amber Terminal starter for Linux (./start.sh) and macOS (double-click start.command, the same script).
#   1. Node.js 22.13+: uses an installed one (also the .runtime one folder up), otherwise downloads a
#      portable copy from nodejs.org into .runtime/node next to this file (checksum verified, no root
#      needed; curl or wget, and tar). Alpine/musl: the official musl build (x64; needs libstdc++).
#   2. Copied alone into an empty folder, it first downloads the app into ./amber-terminal.
#   3. Checks the repo for a newer version and installs it (no git needed; data/ is never touched;
#      a git checkout updates by git, fast-forward only).
#   4. Starts the terminal and opens it in the browser.
# Where updates come from: SETTINGS > Updates, or REPO_URL= / BRANCH= in data/launcher.cfg or in a
# launcher.cfg next to this file; default below. AMBER_UPDATE=0 skips the update check.
# Everything runs inside one { } block: sh reads it completely before running it, so an update that
# rewrites this file can't break it.
{
  REPO_URL_DEFAULT="https://github.com/hoermto/kamiterm.git"
  BRANCH_DEFAULT="master"
  MIN_NODE="22.13.0"

  say() { printf '  %s\n' "$*"; }
  fail() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }
  fetch() { # url file
    if have curl; then curl -fsSL --retry 2 -o "$2" "$1"
    elif have wget; then wget -q -O "$2" "$1"
    else fail "curl or wget is needed to download."
    fi
  }
  cfg_get() { # file key: last KEY=value line, without quotes and CR
    [ -f "$1" ] || return 0
    grep -E "^[[:space:]]*$2[[:space:]]*=" "$1" | tail -n 1 | sed -e 's/^[^=]*=[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//" | tr -d '\r'
  }
  ver_ge() { # a b: a >= b (x.y.z)
    awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, "."); for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 0 }'
  }
  node_ok() { # node binary works and is new enough
    [ -n "$1" ] || return 1
    v=$("$1" -v 2>/dev/null) || return 1
    ver_ge "${v#v}" "$MIN_NODE"
  }
  sha256() {
    if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
    elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
    fi
  }

  BASE=$(cd "$(dirname "$0")" && pwd) || exit 1
  RUNTIME="$BASE/.runtime"
  echo
  say "AMBER TERMINAL - starter"

  # launcher.cfg next to this file: repo and branch for the first install and every update
  REPO_URL=$(cfg_get "$BASE/launcher.cfg" REPO_URL)
  BRANCH=$(cfg_get "$BASE/launcher.cfg" BRANCH)
  AMBER_REPO_URL=${REPO_URL:-${AMBER_REPO_URL:-$REPO_URL_DEFAULT}}
  AMBER_BRANCH=${BRANCH:-${AMBER_BRANCH:-$BRANCH_DEFAULT}}
  export AMBER_REPO_URL AMBER_BRANCH

  # ---- 1. Node.js ----
  # Also the .runtime one folder up: after a first install from a lone start.sh, the app's own copy
  # (./amber-terminal/start.sh) uses the Node that was downloaded next to the first one.
  NODE=""
  for cand in "$RUNTIME/node/bin/node" "$(cd "$BASE/.." && pwd)/.runtime/node/bin/node" "$(command -v node 2>/dev/null)"; do
    if [ -z "${AMBER_FORCE_NODE_DOWNLOAD:-}" ] && node_ok "$cand"; then NODE=$cand; break; fi
  done
  if [ -z "$NODE" ]; then
    os=${AMBER_OS:-$(uname -s)}; arch=${AMBER_ARCH:-$(uname -m)}
    libc=""   # "-musl" on Alpine and other musl Linux: nodejs.org has an official build for x64
    case "$os" in
      Linux|linux) os=linux; key_os=linux; key_suffix="" ;;
      Darwin|darwin) os=darwin; key_os=osx; key_suffix="-tar" ;;
      *) fail "No Node.js $MIN_NODE or newer found, and no portable download for $os. Install it from https://nodejs.org" ;;
    esac
    case "$arch" in
      x86_64|amd64|x64) arch=x64 ;;
      aarch64|arm64) arch=arm64 ;;
      *) fail "No Node.js $MIN_NODE or newer found, and no portable download for $arch. Install it from https://nodejs.org" ;;
    esac
    if [ "$os" = linux ] && { [ -n "${AMBER_MUSL:-}" ] || ldd --version 2>&1 | grep -qi musl || ls /lib/ld-musl-* >/dev/null 2>&1; }; then
      [ "$arch" = x64 ] || fail "This Linux uses musl (e.g. Alpine) on $arch: nodejs.org has no build for it. Install Node.js $MIN_NODE or newer with the package manager (apk add nodejs)."
      libc="-musl"; key_suffix="-musl"
    fi
    say "Node.js $MIN_NODE or newer not found: downloading a portable copy (about 30 MB) ..."
    mkdir -p "$RUNTIME" || fail "Cannot create $RUNTIME"
    tmp="$RUNTIME/download.$$"
    rm -rf "$tmp"; mkdir -p "$tmp"
    fetch "https://nodejs.org/dist/index.json" "$tmp/index.json" || fail "Could not reach nodejs.org"
    # One release per line; the newest LTS with a build for this system, new enough.
    ver=$(grep '"lts":"' "$tmp/index.json" | grep "\"$key_os-$arch$key_suffix\"" | sed -n 's/.*"version":"v\([0-9.]*\)".*/\1/p' | while read -r v; do
      if ver_ge "$v" "$MIN_NODE"; then echo "$v"; break; fi
    done)
    [ -n "$ver" ] || fail "No Node.js LTS download for $os-$arch$libc found."
    say "Node.js v$ver for $os-$arch$libc ..."
    name="node-v$ver-$os-$arch$libc.tar.gz"
    fetch "https://nodejs.org/dist/v$ver/$name" "$tmp/$name" || fail "Download failed: $name"
    fetch "https://nodejs.org/dist/v$ver/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || fail "Download failed: SHASUMS256.txt"
    want=$(grep " $name\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
    got=$(sha256 "$tmp/$name")
    if [ -z "$got" ]; then say "No sha256sum or shasum here: checksum not verified."
    elif [ "$got" != "$want" ]; then fail "Checksum mismatch for $name"
    fi
    tar -xzf "$tmp/$name" -C "$tmp" || fail "Could not unpack $name"
    rm -rf "$RUNTIME/node"
    mv "$tmp/node-v$ver-$os-$arch$libc" "$RUNTIME/node" || fail "Could not install Node.js into $RUNTIME/node"
    rm -rf "$tmp"
    NODE="$RUNTIME/node/bin/node"
    if ! node_ok "$NODE"; then
      [ -n "$libc" ] && fail "The downloaded Node.js does not run here. On Alpine it needs: apk add libstdc++"
      fail "The downloaded Node.js does not run on this system."
    fi
  fi
  say "Node.js  $("$NODE" -v)  $NODE"
  PATH="$(dirname "$NODE"):$PATH"; export PATH

  # Download the branch as .tar.gz from the repo server (GitHub, Gitea/Forgejo: <repo>/archive/<branch>.tar.gz)
  # and copy it over $1. data/, .runtime/ and .git/ in $1 are kept; nothing else is deleted.
  install_archive() {
    web=$(printf '%s' "$AMBER_REPO_URL" | sed -e 's:/*$::' -e 's:\.git$::')
    t="$RUNTIME/app.$$"
    rm -rf "$t"; mkdir -p "$t/x" "$1" || fail "Cannot create $t"
    fetch "$web/archive/$AMBER_BRANCH.tar.gz" "$t/app.tar.gz" || fail "Download failed: $web/archive/$AMBER_BRANCH.tar.gz (repo URL, network or access rights?)"
    tar -xzf "$t/app.tar.gz" -C "$t/x" || fail "Could not unpack the download from $web"
    src=$(find "$t/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    [ -f "$src/server.js" ] || fail "The download from $web is not an Amber Terminal archive."
    for f in "$src"/* "$src"/.[!.]*; do
      [ -e "$f" ] || continue
      case "$(basename "$f")" in data|.runtime|.git) continue ;; esac
      cp -R "$f" "$1/" || fail "Could not copy $(basename "$f") into $1"
    done
    rm -rf "$t"
  }

  # ---- 2. The app: next to this file, or install it into ./amber-terminal ----
  APP=$BASE
  if [ ! -f "$APP/server.js" ]; then
    APP="$BASE/amber-terminal"
    if [ ! -f "$APP/server.js" ]; then
      say "Installing Amber Terminal from $AMBER_REPO_URL ($AMBER_BRANCH) ..."
      install_archive "$APP"
    fi
  elif [ ! -d "$APP/.git" ] && [ ! -f "$APP/data/installed.json" ] && [ "${AMBER_UPDATE:-1}" != "0" ]; then
    # A downloaded copy whose version is not recorded: its own updater may be too old, so refresh it once.
    url=$(cfg_get "$APP/data/launcher.cfg" REPO_URL); br=$(cfg_get "$APP/data/launcher.cfg" BRANCH)
    [ -n "$url" ] && AMBER_REPO_URL=$url
    [ -n "$br" ] && AMBER_BRANCH=$br
    say "Version of this copy unknown (download): getting the current one from $AMBER_REPO_URL ($AMBER_BRANCH) ..."
    install_archive "$APP"
  fi
  cd "$APP" || exit 1
  chmod +x start.sh start.command 2>/dev/null

  # ---- 3. Update (never blocks the start) ----
  if [ "${AMBER_UPDATE:-1}" != "0" ]; then
    "$NODE" scripts/update.js --apply
  fi

  # ---- 4. npm-Abhängigkeiten (z. B. nodemailer; nur wenn nötig, blockiert den Start nie) ----
  "$NODE" scripts/deps.js || true

  # ---- 5. Start ----
  exec "$NODE" server.js --open
}
