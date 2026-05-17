#!/bin/bash
export PATH="/Users/zhiwei/.local/share/fnm/node-versions/v24.3.0/installation/bin:$PATH"
export NODE_ENV=production
export MINIAGENT_API_PORT=7273
cd /Users/zhiwei/Projects/MiniAgent || exit 1
exec node node_modules/tsx/dist/cli.mjs src/server/http/server.ts
