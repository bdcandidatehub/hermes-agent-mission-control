#!/bin/sh
# Lets the bridge drive a Hermes that runs inside a Docker container:
#   HERMES_BIN=/absolute/path/to/hermes-bridge/hermes-docker.sh
# Set HERMES_CONTAINER if your container isn't named "hermes".
exec docker exec "${HERMES_CONTAINER:-hermes}" hermes "$@"
