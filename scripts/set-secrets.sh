#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

# Load .env
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [ -z "$RTT_TOKEN" ]; then
  echo "Error: RTT_TOKEN not set in .env"
  exit 1
fi

echo "Setting RTT_TOKEN secret on GitHub repo..."
gh secret set RTT_TOKEN --body "$RTT_TOKEN"
echo "Done."
