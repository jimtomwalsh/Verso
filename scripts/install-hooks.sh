#!/bin/sh
# Enable the repo's git hooks (one-time, per clone). Points git at the version-controlled
# hooks in scripts/hooks/ so the pre-commit hygiene gate runs before every commit.
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/* 2>/dev/null || true
echo "Git hooks enabled (core.hooksPath = scripts/hooks). Pre-commit hygiene gate is active."
