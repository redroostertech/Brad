#!/bin/bash
#
# Brad — Brand Reach Automation & Distribution
# Setup script — configures a project directory for Brad
#
# Usage:
#   ./setup.sh --site https://yoursite.com --name "Your Product"
#   ./setup.sh --site https://yoursite.com --name "Your Product" --provider anthropic
#   ./setup.sh --site https://yoursite.com --name "Your Product" --focus "views/app,docs"
#   ./setup.sh --skill                    # Install Claude Code skill only
#

set -e

BRAD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(pwd)"

# ── Parse arguments ───────────────────────────────────────
SITE=""
NAME=""
PROVIDER="openai"
FOCUS=""
LOCAL=""
SKILL_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --site)      SITE="$2"; shift 2 ;;
    --name)      NAME="$2"; shift 2 ;;
    --provider)  PROVIDER="$2"; shift 2 ;;
    --focus)     FOCUS="$2"; shift 2 ;;
    --local)     LOCAL="$2"; shift 2 ;;
    --skill)     SKILL_ONLY=true; shift ;;
    --help|-h)
      echo ""
      echo "  Brad Setup"
      echo ""
      echo "  Usage:"
      echo "    ./setup.sh --site <url> --name <name> [options]"
      echo "    ./setup.sh --skill"
      echo ""
      echo "  Options:"
      echo "    --site <url>         Your website URL (required)"
      echo "    --name <name>        Product/company name (required)"
      echo "    --provider <name>    LLM provider: openai|anthropic|lana|ollama (default: openai)"
      echo "    --focus <paths>      Comma-separated paths to focus on"
      echo "    --local <url>        Local dev URL"
      echo "    --skill              Install Claude Code /brad skill only"
      echo ""
      exit 0
      ;;
    *)
      echo "  Unknown option: $1"
      echo "  Run: ./setup.sh --help"
      exit 1
      ;;
  esac
done

echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║  Brad — Setup                                     ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""

# ── Install Claude Code skill ─────────────────────────────
if [ "$SKILL_ONLY" = true ]; then
  echo "  Installing Claude Code /brad skill..."
  mkdir -p "$PROJECT_DIR/.claude/skills/brad"
  cp "$BRAD_DIR/skill/SKILL.md" "$PROJECT_DIR/.claude/skills/brad/SKILL.md"
  echo "  ✓ Skill installed at .claude/skills/brad/SKILL.md"
  echo ""
  echo "  In Claude Code, run: /brad setup"
  echo ""
  exit 0
fi

# ── Validate required arguments ───────────────────────────
if [ -z "$SITE" ] || [ -z "$NAME" ]; then
  echo "  ✗ --site and --name are required."
  echo "    Run: ./setup.sh --help"
  echo ""
  exit 1
fi

# ── Check brad is installed ───────────────────────────────
if ! command -v brad &> /dev/null; then
  echo "  Brad not installed. Running install first..."
  echo ""
  bash "$BRAD_DIR/install.sh"
  echo ""
fi

# ── Check API key ─────────────────────────────────────────
case $PROVIDER in
  openai)
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "  ⚠ OPENAI_API_KEY not set."
      echo "    Set it: export OPENAI_API_KEY=sk-your-key"
      echo "    Or use --provider lana|ollama for local LLMs"
      echo ""
    else
      echo "  ✓ OPENAI_API_KEY is set"
    fi
    ;;
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ]; then
      echo "  ⚠ ANTHROPIC_API_KEY not set."
      echo "    Set it: export ANTHROPIC_API_KEY=sk-ant-your-key"
      echo ""
    else
      echo "  ✓ ANTHROPIC_API_KEY is set"
    fi
    ;;
  lana|ollama)
    echo "  ✓ Using local provider: $PROVIDER"
    ;;
esac

# ── Install Claude Code skill ─────────────────────────────
echo "  Installing Claude Code /brad skill..."
mkdir -p "$PROJECT_DIR/.claude/skills/brad"
cp "$BRAD_DIR/skill/SKILL.md" "$PROJECT_DIR/.claude/skills/brad/SKILL.md"
echo "  ✓ Claude Code skill installed"

# ── Build brad init command ───────────────────────────────
INIT_CMD="brad init --site \"$SITE\" --name \"$NAME\" --provider $PROVIDER"
if [ -n "$FOCUS" ]; then
  INIT_CMD="$INIT_CMD --focus \"$FOCUS\""
fi
if [ -n "$LOCAL" ]; then
  INIT_CMD="$INIT_CMD --local \"$LOCAL\""
fi

echo ""
echo "  Running: $INIT_CMD"
echo ""

# ── Run brad init ─────────────────────────────────────────
eval $INIT_CMD

echo ""
echo "  Setup complete."
echo ""
