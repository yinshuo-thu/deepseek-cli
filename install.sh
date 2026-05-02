#!/usr/bin/env bash
# DeepSeek-CLI installer — bash one-liner mirror of `claude.ai/install.sh`.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yinshuo-thu/deepseek-cli/main/install.sh | bash
#
# Behaviour:
#   - if Node 18+ is available, install via `npm i -g @yinshuo-thu/deepseek-cli`
#   - otherwise, print clear instructions for installing Node
#   - in M5 this will fall back to downloading prebuilt binaries from GitHub Releases.

set -euo pipefail

BLUE=$'\033[38;5;75m'
DIM=$'\033[2m'
RED=$'\033[31m'
RESET=$'\033[0m'

say() { printf "%s\n" "$*"; }
err() { printf "%b%s%b\n" "$RED" "$*" "$RESET" >&2; }

cat <<'BANNER'

        .-""""""-.
      .'          '.
     /   O      O   \
    :           '    :       DeepSeek-CLI installer
    |                |
    :    .------.    :
     \  '        '  /
      '. '------' .'
        '-..____.-'

BANNER

# Check Node.
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version | sed 's/v//; s/\..*//')"
  if [ "$NODE_VER" -ge 18 ]; then
    say "${BLUE}→${RESET} Node $(node --version) detected, installing via npm…"
    if command -v npm >/dev/null 2>&1; then
      npm i -g @yinshuo-thu/deepseek-cli
      say ""
      say "${BLUE}✓${RESET} Installed. Run: ${BLUE}deepseek${RESET}"
      exit 0
    fi
  fi
fi

err "Node 18+ not found."
say ""
say "Install Node first, then re-run this script. Recommended:"
say "  ${BLUE}brew install node${RESET}                # macOS"
say "  ${BLUE}sudo apt install nodejs npm${RESET}      # Debian/Ubuntu"
say "  ${BLUE}curl -fsSL https://fnm.vercel.app/install | bash${RESET}  # any Unix"
say ""
say "(In M5, this script will fall back to a prebuilt binary release.)"
exit 1
