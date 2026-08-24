#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: falta .env. Ejecute: cp .env.example .env" >&2
  exit 2
fi

if [[ ! -d node_modules ]]; then
  npm ci
fi

exec npm run dev

