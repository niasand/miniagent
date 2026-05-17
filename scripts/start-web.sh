#!/bin/bash
export PATH="/Users/zhiwei/.local/share/fnm/node-versions/v24.3.0/installation/bin:$PATH"
export NODE_ENV=production
cd /Users/zhiwei/Documents/MiniAgent || exit 1
exec node node_modules/.bin/vite preview --host 127.0.0.1 --port 4173
