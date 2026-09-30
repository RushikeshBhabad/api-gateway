#!/bin/bash

# ==============================================================================
# Bookstore Microservices - Stop Script
# Stops all running microservices and processes
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "🛑 Stopping all microservice background processes..."
npx --yes pm2 stop "$DIR/ecosystem.config.cjs" || true
npx --yes pm2 delete all || true

echo "✅ All microservices stopped successfully."
