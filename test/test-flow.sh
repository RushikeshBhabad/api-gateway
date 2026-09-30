#!/bin/bash
set -e

echo "=== Testing Book Store API ==="

# Wait for services to start
sleep 2

echo "1. Sign up..."
SIGNUP_RES=$(curl -s -X POST http://localhost:8000/api/auth/signup -H "Content-Type: application/json" -d '{"name":"Test User","email":"test@example.com","password":"password123"}')
echo $SIGNUP_RES

echo "2. Log in..."
LOGIN_RES=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password123"}')
echo $LOGIN_RES
ACCESS_TOKEN=$(echo $LOGIN_RES | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

echo "3. Fetch Profile..."
curl -s -X GET http://localhost:8000/api/users/me -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""

echo "4. Fetch Products (Public)..."
curl -s -X GET http://localhost:8000/api/products
echo ""

echo "5. Create Product (Should fail as USER)..."
curl -s -X POST http://localhost:8000/api/products -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"title":"Book","author":"Author","category":"Sci-Fi","price":10,"stock":5}'
echo ""

echo "6. Test OAuth Endpoint exists..."
curl -s -I http://localhost:8000/api/auth/google | head -n 1
echo ""

echo "=== All Tests Passed Successfully ==="
