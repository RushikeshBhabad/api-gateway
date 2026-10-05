#!/bin/bash

# ==============================================================================
# Load Balancer Test Script
# Tests all 5 load balancing algorithms against the API Gateway
# ==============================================================================

GATEWAY="http://localhost:8000"
NUM_REQUESTS=${1:-20}

echo ""
echo "============================================================="
echo "🔄 LOAD BALANCER DISTRIBUTION TEST"
echo "============================================================="
echo "Gateway:    $GATEWAY"
echo "Requests:   $NUM_REQUESTS"
echo "Strategy:   $(grep LOAD_BALANCER_STRATEGY ../.env 2>/dev/null | head -1 || echo 'Check .env')"
echo "============================================================="

echo ""
echo "📦 Testing /api/products (Product Service instances):"
echo "-------------------------------------------------------------"

declare -A instance_count

for i in $(seq 1 $NUM_REQUESTS); do
  RESPONSE=$(curl -s -D - -o /dev/null "$GATEWAY/api/products" 2>/dev/null)
  INSTANCE=$(echo "$RESPONSE" | grep -i "x-upstream-instance" | tr -d '\r' | awk '{print $2}')
  URL=$(echo "$RESPONSE" | grep -i "x-upstream-url" | tr -d '\r' | awk '{print $2}')
  STRATEGY=$(echo "$RESPONSE" | grep -i "x-lb-strategy" | tr -d '\r' | awk '{print $2}')
  STATUS=$(echo "$RESPONSE" | head -1 | awk '{print $2}')
  
  if [ -n "$INSTANCE" ]; then
    echo "  Request $i → $INSTANCE ($URL) [HTTP $STATUS]"
    instance_count[$INSTANCE]=$(( ${instance_count[$INSTANCE]:-0} + 1 ))
  else
    echo "  Request $i → ❌ No instance header (HTTP $STATUS)"
  fi
done

echo ""
echo "📊 Distribution Summary:"
echo "-------------------------------------------------------------"
for instance in "${!instance_count[@]}"; do
  count=${instance_count[$instance]}
  pct=$(echo "scale=1; $count * 100 / $NUM_REQUESTS" | bc 2>/dev/null || echo "N/A")
  echo "  $instance: $count requests ($pct%)"
done

if [ -n "$STRATEGY" ]; then
  echo ""
  echo "🎯 Strategy: $STRATEGY"
fi

echo ""
echo "============================================================="
echo "✅ Test Complete"
echo "============================================================="
