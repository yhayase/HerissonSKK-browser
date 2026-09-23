#!/usr/bin/env bash
# AMO 審査用ソースから Firefox 配布物を再現します。
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(node --version)" != 'v24.1.0' || "$(npm --version)" != '11.19.1' ]]; then
  echo 'Node.js 24.1.0 と npm 11.19.1 を使用してください。' >&2
  exit 1
fi
npm ci --no-audit --no-fund
npm run zip:firefox
