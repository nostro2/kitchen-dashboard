#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

npm install
npm run build
npx http-server . -p 3000 -o
