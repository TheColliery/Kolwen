#!/usr/bin/env bash
# Read-only probe of a WSL distro for the Kolwen rendered check (started by scripts/lib/wsl-route.mjs with argv). It makes nothing and deletes nothing.
#   probe.sh          prints "kolwen-wsl: OK" when the headless shell is executable at its STABLE path, else "kolwen-wsl: NOBIN"
#   probe.sh count    prints "kolwen-wsl: RUNS=<n>", the number of /tmp/kolwen-browser-run-* folders (a finished run leaves none)
set -u
[ -n "${HOME:-}" ] || { echo "kolwen-wsl: NOHOME"; exit 2; }
case "${1:-}" in
  count)
    n=0
    for d in /tmp/kolwen-browser-run-*; do [ -e "$d" ] && n=$((n + 1)); done
    echo "kolwen-wsl: RUNS=$n"
    ;;
  '')
    if [ -x "$HOME/tools/chrome-headless-shell-linux64/chrome-headless-shell" ]; then echo "kolwen-wsl: OK"; else echo "kolwen-wsl: NOBIN"; exit 5; fi
    ;;
  *)
    echo "kolwen-wsl: BADARG"
    exit 2
    ;;
esac
