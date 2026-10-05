#!/bin/bash

# =====================================================================
# ⚖️ LOAD BALANCER ALGORITHM TEST SCRIPT
# =====================================================================
# 
# CHOOSE YOUR ALGORITHM:
# Copy and paste ONE of the following into the ALGO variable below:
# 
# ROUND_ROBIN
# WEIGHTED_ROUND_ROBIN
# LEAST_CONNECTIONS
# RANDOM
# CONSISTENT_HASHING
# =====================================================================

ALGO="RANDOM"    # <--- CHANGE THIS VALUE!

# =====================================================================

SERVICE="product"      # Using 'product' service to avoid auth/rate limits
INSTANCES=20          # Number of microservice instances to boot
REQUESTS=60           # Number of requests to send (kept under 100 to avoid rate limit)

echo "======================================================"
echo "🚀 Booting $INSTANCES instances of $SERVICE-service..."
echo "⚙️  Algorithm: $ALGO"
echo "======================================================"

# Stop any persistent PM2 instances to avoid port 8000 conflicts
echo "Stopping any existing PM2 Gateway processes..."
npx pm2 stop api-gateway > /dev/null 2>&1

# 1. Start the backend instances and a test API Gateway dynamically
npm run test:lb -- $SERVICE $INSTANCES $ALGO > /dev/null 2>&1 &
HARNESS_PID=$!

# Wait for the Gateway and microservices to fully boot
sleep 10

echo ""
echo "📡 Sending $REQUESTS requests..."
echo "------------------------------------------------------"

# 2. Run the request generator which prints exactly what you requested
# Example output: Request 1 → product-4001 ✓
if [ "$ALGO" == "CONSISTENT_HASHING" ]; then
    node test/send-requests.js $SERVICE $REQUESTS $ALGO "user-123"
elif [ "$ALGO" == "LEAST_CONNECTIONS" ]; then
    node test/concurrent-test.js $SERVICE $REQUESTS $ALGO
else
    node test/send-requests.js $SERVICE $REQUESTS $ALGO
fi

# 3. Clean up all child processes so they don't consume memory
echo ""
echo "🧹 Cleaning up test processes..."
npm run test:lb:stop > /dev/null 2>&1
kill $HARNESS_PID 2>/dev/null

echo "✅ Test complete!"
