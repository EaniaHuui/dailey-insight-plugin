#!/bin/bash

set -euo pipefail

VAULT_PATH="${1:-$HOME/Documents/ObsidianVault}"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/insight-flow"

mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css versions.json "$PLUGIN_DIR"/

echo "Deployed insight-flow to $PLUGIN_DIR"
