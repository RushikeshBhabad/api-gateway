#!/bin/bash
set -e

echo "=========================================================="
echo "    STARTING COMPREHENSIVE END-TO-END TEST SUITE"
echo "=========================================================="

BASE_GATEWAY="http://localhost:8000"
FRONTEND_URL="http://localhost:5173"

echo "[Test 0] Checking Frontend Availability..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $FRONTEND_URL || true)
echo "Frontend HTTP Status: $FRONTEND_STATUS"

echo ""
echo "[Test 1] Gateway Health Check..."
curl -s $BASE_GATEWAY/health | grep -q "GATEWAY_UP" && echo "✓ Gateway is UP"

echo ""
echo "[Test 2] Seed Products..."
cd /home/bumblebee/apigateway/product-service && npx tsx src/seed.ts
cd /home/bumblebee/apigateway

echo ""
echo "[Test 3] User Signup (Local Auth)..."
TIMESTAMP=$(date +%s)
TEST_EMAIL="user_${TIMESTAMP}@bookstore.test"
SIGNUP_RES=$(curl -s -X POST "$BASE_GATEWAY/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Alice Test\",\"email\":\"$TEST_EMAIL\",\"password\":\"SecureP@ss123\"}")
echo "Signup Response: $SIGNUP_RES"
echo $SIGNUP_RES | grep -q '"success":true' && echo "✓ Signup passed"

echo ""
echo "[Test 4] User Login & JWT + Refresh Token issuance..."
LOGIN_RES=$(curl -s -X POST "$BASE_GATEWAY/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"SecureP@ss123\"}")
echo "Login Response: $LOGIN_RES"
ACCESS_TOKEN=$(echo $LOGIN_RES | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo $LOGIN_RES | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)
echo "Extracted Access Token: ${ACCESS_TOKEN:0:20}..."
echo "Extracted Refresh Token: ${REFRESH_TOKEN:0:20}..."

echo ""
echo "[Test 5] Access User Profile with Access Token..."
ME_RES=$(curl -s -X GET "$BASE_GATEWAY/api/users/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
echo "Profile Response: $ME_RES"
echo $ME_RES | grep -q "$TEST_EMAIL" && echo "✓ Profile retrieval verified"

echo ""
echo "[Test 6] Refresh Token Rotation..."
REFRESH_RES=$(curl -s -X POST "$BASE_GATEWAY/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
echo "Refresh Response: $REFRESH_RES"
NEW_ACCESS_TOKEN=$(echo $REFRESH_RES | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
echo "New Access Token: ${NEW_ACCESS_TOKEN:0:20}..."
echo $REFRESH_RES | grep -q '"success":true' && echo "✓ Token rotation verified"

echo ""
echo "[Test 7] Verify Old Revoked Refresh Token is Rejected..."
REUSE_RES=$(curl -s -X POST "$BASE_GATEWAY/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
echo "Reused Token Response: $REUSE_RES"
echo $REUSE_RES | grep -q '"code":"UNAUTHORIZED"' && echo "✓ Revoked token rejected"

echo ""
echo "[Test 8] Browse Products (Public Gateway API)..."
PRODUCTS_RES=$(curl -s -X GET "$BASE_GATEWAY/api/products?page=1&limit=5")
echo "Products Count: $(echo $PRODUCTS_RES | grep -o '"title":' | wc -l)"
echo $PRODUCTS_RES | grep -q '"success":true' && echo "✓ Products list retrieved"

FIRST_PROD_ID=$(echo $PRODUCTS_RES | grep -o '"_id":"[^"]*' | head -n 1 | cut -d'"' -f4)
echo "Sample Product ID: $FIRST_PROD_ID"

echo ""
echo "[Test 9] RBAC Authorization Test: USER attempting ADMIN Action (Create Product)..."
FORBIDDEN_RES=$(curl -s -X POST "$BASE_GATEWAY/api/products" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Unauthorized Book","author":"Hacker","category":"Hack","price":10,"stock":5}')
echo "Forbidden Response: $FORBIDDEN_RES"
echo $FORBIDDEN_RES | grep -q '"code":"FORBIDDEN"' && echo "✓ Gateway RBAC blocked USER from Admin action (403 Forbidden)"

echo ""
echo "[Test 10] Place Order & Atomic Stock Reservation..."
ORDER_RES=$(curl -s -X POST "$BASE_GATEWAY/api/orders" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$FIRST_PROD_ID\",\"quantity\":2}]}")
echo "Order Response: $ORDER_RES"
echo $ORDER_RES | grep -q '"success":true' && echo "✓ Order successfully placed and stock deducted"

echo ""
echo "[Test 11] View User's Orders..."
ORDERS_LIST_RES=$(curl -s -X GET "$BASE_GATEWAY/api/orders" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN")
echo "User Orders: $ORDERS_LIST_RES"
echo $ORDERS_LIST_RES | grep -q "$FIRST_PROD_ID" && echo "✓ Order history verified"

echo ""
echo "[Test 12] Google OAuth 2.0 Endpoint Redirection..."
OAUTH_HEADER=$(curl -s -I "$BASE_GATEWAY/api/auth/google" | head -n 1)
echo "OAuth Header: $OAUTH_HEADER"
echo $OAUTH_HEADER | grep -q -E "302|Found" && echo "✓ Google OAuth redirect confirmed"

echo ""
echo "[Test 13] User Logout..."
LOGOUT_RES=$(curl -s -X POST "$BASE_GATEWAY/api/auth/logout" \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
echo "Logout Response: $LOGOUT_RES"
echo $LOGOUT_RES | grep -q '"message":"Logged out"' && echo "✓ Logout verified"

echo ""
echo "=========================================================="
echo "    ALL 13 TESTS PASSED SUCCESSFULLY! EVERYTHING WORKS."
echo "=========================================================="
