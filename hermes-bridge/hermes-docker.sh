#!/bin/sh
# Lets the bridge drive a Hermes that runs inside a Docker container:
#   HERMES_BIN=/absolute/path/to/hermes-bridge/hermes-docker.sh
# Set HERMES_CONTAINER if your container isn't named "hermes".
#
# Killing this script (e.g. Node's execFile `timeout` option, on a SIGTERM) only ever kills the local
# `docker exec` client — Docker does not propagate that signal into the container, so the actual `hermes`
# process keeps running there, orphaned, indefinitely. That's not just wasted work: it keeps holding
# Hermes' session-ownership lease, which then makes every later call to the same --continue session fail
# instantly with SESSION_NOT_OWNED, with no way to tell until you go looking for the stuck process by hand.
#
# So the timeout is enforced INSIDE the container instead, via GNU coreutils `timeout` (present in the
# Hermes image), which sends the process its own SIGTERM (then SIGKILL 10s later if it's still alive) from
# inside the same PID namespace — no cross-boundary signal delivery required. The bridge passes the timeout
# it's using via HERMES_EXEC_TIMEOUT_MS so the two stay in sync; without it (or a bad value) this defaults
# to 5 minutes.
case "$HERMES_EXEC_TIMEOUT_MS" in
  ''|*[!0-9]*) ms=300000 ;;
  *) ms="$HERMES_EXEC_TIMEOUT_MS" ;;
esac
secs=$((ms / 1000))
[ "$secs" -lt 1 ] && secs=1

exec docker exec "${HERMES_CONTAINER:-hermes}" timeout --kill-after=10 "${secs}s" hermes "$@"
