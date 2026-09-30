#!/bin/bash

# ==============================================================================
# Bookstore Microservices - Single Master Startup Script (PM2 Process Manager)
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo ""
echo "🚀 ==========================================================="
echo "📚 Starting Bookstore Microservices System..."
echo "============================================================="

# 1. Start all 5 services using PM2 Process Manager
echo "📦 Starting all 5 services with PM2..."
npx --yes pm2 start "$DIR/ecosystem.config.cjs" || npx --yes pm2 restart "$DIR/ecosystem.config.cjs"

# 2. Wait for ports to initialize
sleep 2

# 3. Display Status Table
echo ""
echo "✨ ==========================================================="
echo "🎉 ALL MICROSERVICES ARE LIVE & RUNNING!"
echo "============================================================="
npx pm2 list
echo ""
echo "🌐 Available Endpoints:"
echo "   👉 Frontend UI:      http://localhost:5173"
echo "   👉 API Gateway:      http://localhost:8000"
echo "   🔒 User Service:     http://localhost:3001 (Internal / Proxied)"
echo "   📦 Product Service:  http://localhost:3002 (Internal / Proxied)"
echo "   🛒 Order Service:    http://localhost:3003 (Internal / Proxied)"
echo "============================================================="
echo "💡 Commands:"
echo "   - To stop everything:       ./stop.sh"
echo "   - To restart API Gateway:   npx pm2 restart api-gateway"
echo "   - To view gateway logs:     npx pm2 logs api-gateway"
echo "============================================================="
echo ""
