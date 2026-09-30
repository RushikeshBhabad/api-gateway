#!/bin/bash
# use npx pm2 restart api-gateway to restart the gateway and all services
# then use ./test-ratelimit.sh to test the rate limiters

echo "============================================="
echo "🧪 TESTING SLIDING WINDOW LIMITER (/api/auth)"
echo "Limit: 100 requests per 60s"
echo "============================================="
for i in {1..50}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"test"}')
  
  if [ "$STATUS" == "429" ]; then
    echo "Request $i: 🔴 BLOCKED (HTTP 429 Too Many Requests)"
  else
    echo "Request $i: 🟢 ALLOWED (HTTP $STATUS)"
  fi
done

echo ""
echo "============================================="
echo "🧪 TESTING TOKEN BUCKET LIMITER (/api/orders)"
echo "Limit: Capacity 10, Refills 1 per second"
echo "Note: We need a valid JWT token to hit orders, but rate limit triggers BEFORE auth middleware!"
echo "============================================="
for i in {1..12}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/orders -H "Content-Type: application/json" -d '{}')
  
  if [ "$STATUS" == "429" ]; then
    echo "Request $i: 🔴 BLOCKED (HTTP 429 Too Many Requests)"
  elif [ "$STATUS" == "401" ]; then
    echo "Request $i: 🟢 ALLOWED by Limiter -> 🔴 BLOCKED by Auth (HTTP 401)"
  else
    echo "Request $i: 🟢 ALLOWED (HTTP $STATUS)"
  fi
done

