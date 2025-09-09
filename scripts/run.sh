#!/usr/bin/env bash
set -eu -o pipefail -E
cd `dirname "$0"`
cd ..

if [ ! -d data ]; then
    mkdir -p data
    chmod 777 data
fi

podman run -it --rm \
    --name n8n-nodes-smartcache \
    -p 5678:5678 \
    -p 9229:9229 \
    -v $(pwd)/data:/home/node/.n8n \
    -v $XDG_RUNTIME_DIR/podman/podman.sock:/var/run/docker.sock \
    -e GENERIC_TIMEZONE="Europe/Madrid" \
    -e TZ="Europe/Madrid" \
    -e NODE_ENV="${NODE_ENV:-production}" \
    -e N8N_DEV_RELOAD="${N8N_DEV_RELOAD:-false}" \
    -e NODE_OPTIONS="${NODE_OPTIONS:-}" \
    docker.n8n.io/n8nio/n8n

    # -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS="true" \