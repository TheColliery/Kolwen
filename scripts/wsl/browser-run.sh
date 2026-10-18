#!/usr/bin/env bash
# Runs the Blink headless shell inside WSL for the Kolwen rendered check (scripts/lib/wsl-route.mjs starts this file with argv; nothing here is ever typed into an inline `wsl.exe bash -lc`).
#   usage: browser-run.sh <devtools-port> <lifetime-seconds>
# The browser is the headless shell at its STABLE path, never a versioned folder (the stable link is kept current by the machine's updater). It listens on 127.0.0.1:<port> inside the distro, which
# Windows reaches through WSL's localhost forwarding. Its profile is made here, in a mktemp folder of its own under /tmp, and removed at the end: that folder is the ONLY thing this script deletes.
set -u

PORT="${1:-}"
LIFETIME="${2:-}"
case "$PORT" in ''|*[!0-9]*) echo "kolwen-wsl: BADPORT"; exit 2 ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || { echo "kolwen-wsl: BADPORT"; exit 2; }
case "$LIFETIME" in ''|*[!0-9]*) echo "kolwen-wsl: BADLIFETIME"; exit 2 ;; esac
[ "$LIFETIME" -ge 5 ] && [ "$LIFETIME" -le 7200 ] || { echo "kolwen-wsl: BADLIFETIME"; exit 2; }
[ -n "${HOME:-}" ] || { echo "kolwen-wsl: NOHOME"; exit 2; }

BIN="$HOME/tools/chrome-headless-shell-linux64/chrome-headless-shell"
[ -x "$BIN" ] || { echo "kolwen-wsl: NOBIN"; exit 5; }

# The run's own folder. RUN is checked against the shape mktemp gives it, against being a real directory (not a link) and against resolving to itself under /tmp, before anything is put in it and
# again before anything is removed. $HOME is never touched: the browser gets its own HOME inside RUN.
RUN=$(mktemp -d /tmp/kolwen-browser-run-XXXXXX) || { echo "kolwen-wsl: NOMKTEMP"; exit 6; }

guard() {
  [ -n "${RUN:-}" ] || return 1
  case "$RUN" in /tmp/kolwen-browser-run-??????) ;; *) return 1 ;; esac
  [ -d "$RUN" ] && [ ! -L "$RUN" ] || return 1
  local real
  real=$(realpath -e -- "$RUN") || return 1
  [ "$real" = "$RUN" ] || return 1
  case "$real" in /tmp/?*) ;; *) return 1 ;; esac
  [ "$real" != "$HOME" ] || return 1
  return 0
}

guard || { echo "kolwen-wsl: BADRUN"; exit 6; }
echo "kolwen-wsl: RUN=$RUN"

CHILD=""
cleanup() {
  trap - EXIT
  if [ -n "$CHILD" ]; then
    kill -TERM "$CHILD" 2>/dev/null
    wait "$CHILD" 2>/dev/null
  fi
  if guard; then
    rm -rf -- "$RUN"
    if [ -e "$RUN" ]; then echo "kolwen-wsl: LEFT $RUN"; else echo "kolwen-wsl: GONE"; fi
  else
    echo "kolwen-wsl: REFUSED $RUN"
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM INT HUP

mkdir -m 700 -- "$RUN/profile" "$RUN/home" || { echo "kolwen-wsl: NOPROFILE"; exit 6; }

# The same switches as the native route's (scripts/lib/browser.mjs COMMON_ARGS): no sync, no component update, no background networking, and no host name resolves except through 127.0.0.1.
HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home" XDG_CACHE_HOME="$RUN/home" TMPDIR="$RUN" \
  timeout -k 5 "$LIFETIME" "$BIN" \
  --remote-debugging-port="$PORT" --remote-debugging-address=127.0.0.1 --user-data-dir="$RUN/profile" \
  --no-first-run --no-default-browser-check --disable-gpu --disable-extensions --disable-background-networking \
  --disable-component-update --disable-sync --metrics-recording-only --hide-scrollbars --js-flags=--max-old-space-size=512 \
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1' --font-render-hinting=none about:blank &
CHILD=$!
wait "$CHILD"
exit 0
