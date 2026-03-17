#!/bin/bash
#
# Brad — Brand Reach Automation & Distribution
# Install script
#

set -e

BRAD_DIR="$(cd "$(dirname "$0")" && pwd)"
REQUIRED_NODE_VERSION=20

echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║  Brad — Brand Reach Automation & Distribution     ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""

# ── Check Node.js ──────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "  ✗ Node.js not found."
  echo "    Install Node.js 20+: https://nodejs.org"
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$REQUIRED_NODE_VERSION" ]; then
  echo "  ✗ Node.js $REQUIRED_NODE_VERSION+ required. Found: $(node -v)"
  echo "    Update Node.js: https://nodejs.org"
  echo ""
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# ── Check npm ──────────────────────────────────────────────
if ! command -v npm &> /dev/null; then
  echo "  ✗ npm not found."
  exit 1
fi
echo "  ✓ npm $(npm -v)"

# ── Install dependencies ──────────────────────────────────
echo ""
echo "  Installing dependencies..."
cd "$BRAD_DIR"
npm install --silent 2>&1 | tail -1
echo "  ✓ Dependencies installed"

# ── Link globally ─────────────────────────────────────────
echo ""
echo "  Linking brad command globally..."
npm link --silent 2>&1
echo "  ✓ brad command available"

# ── Verify ────────────────────────────────────────────────
echo ""
if command -v brad &> /dev/null; then
  echo "  ✓ Installed: brad $(brad --version)"
else
  echo "  ⚠ brad command not found in PATH."
  echo "    You may need to add npm's global bin to your PATH."
  echo "    Try: export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
fi

echo ""
echo "  Next steps:"
echo ""
echo "    1. Set your API key:"
echo "       export OPENAI_API_KEY=sk-your-key"
echo ""
echo "    2. Go to your project and initialize:"
echo "       cd ~/your-project"
echo "       brad init --site https://yoursite.com --name \"Your Product\""
echo ""
echo "    3. Run brad help for all commands"
echo ""
