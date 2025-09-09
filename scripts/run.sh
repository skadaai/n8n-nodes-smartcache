#!/usr/bin/env bash
set -eu -o pipefail -E
cd `dirname "$0"`
cd ..

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No color

if [ ! -d dist ]; then
    pnpm run build
fi

if [ ! -d data ]; then
    printf "${YELLOW}Data directory not found. ${BLUE}Creating...${NC}\n"
    mkdir -p data
    chmod 777 data
fi

if [ "${1:-}" = "dev" ]; then
    NODE_ENV="development"
    N8N_DEV_RELOAD="true"
    NODE_OPTIONS="--inspect=0.0.0.0:9229"

    printf "${YELLOW}Hot-reload is active.\n${NC}"

    tsc --watch &
    WATCH_PID=$!
    trap 'kill $WATCH_PID' EXIT
fi

printf "\n${GREEN}Running Podman instance of N8N:\n${NC}"
podman run -it --rm \
    --name n8n-nodes-smartcache \
    -p 5678:5678 \
    -p 9229:9229 \
    -v $(pwd)/data:/home/node/.n8n \
    -v $XDG_RUNTIME_DIR/podman/podman.sock:/var/run/docker.sock \
    -e NODE_ENV="${NODE_ENV:-production}" \
    -e N8N_DEV_RELOAD="${N8N_DEV_RELOAD:-false}" \
    -e NODE_OPTIONS="${NODE_OPTIONS:-}" \
    -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS="true" \
    -v $(pwd):/custom \
    -e N8N_CUSTOM_EXTENSIONS=/custom \
    docker.n8n.io/n8nio/n8n

    # -e N8N_LOG_LEVEL="debug" \

trap 'echo "${RED}Error occurred!${NC}"' ERR