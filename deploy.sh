#!/bin/bash

set -euo pipefail

VAULT_PATH="${1:-$HOME/Documents/ObsidianVault}"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/dailey-insight"

mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css versions.json "$PLUGIN_DIR"/

echo "Deployed dailey-insight to $PLUGIN_DIR"
