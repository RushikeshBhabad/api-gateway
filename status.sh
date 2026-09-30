#!/bin/bash

# ==============================================================================
# Bookstore Microservices - Status Script
# Shows current status of all services and listening ports
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "📊 PM2 Microservices Status:"
npx pm2 list

echo ""
echo "🔌 Active Port Listeners:"
ss -tulpn | grep -E '5173|8000|3001|3002|3003' || true
