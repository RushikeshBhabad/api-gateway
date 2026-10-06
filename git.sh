#!/bin/bash

# =====================================================================
# 🚀 ONE-COMMAND GIT SYNC SCRIPT
# =====================================================================
# Usage:
#   ./git.sh                    (uses default commit message)
#   ./git.sh "your message"     (uses custom commit message)
# =====================================================================

set -e

# Default commit message if none provided
COMMIT_MSG="${1:-update: sync latest changes and documentation}"

echo "=========================================="
echo "📦 Staging all changed and new files..."
echo "=========================================="
git add -A

# Check if there are any changes staged
if git diff --cached --quiet; then
    echo "ℹ️  No changes to commit. Working tree is clean."
else
    echo "📝 Committing with message: '$COMMIT_MSG'..."
    git commit -m "$COMMIT_MSG"
fi

# Detect current git branch
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    CURRENT_BRANCH="main"
fi

echo "🚀 Pushing to origin/$CURRENT_BRANCH..."
git push origin "$CURRENT_BRANCH"

echo ""
echo "✅ Successfully pushed to GitHub!"
echo "=========================================="
