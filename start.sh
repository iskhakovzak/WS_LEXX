#!/bin/sh
export PORT=5000
export NODE_ENV=production
exec node artifacts/api-server/dist/index.mjs
