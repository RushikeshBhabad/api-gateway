curl -s -i -X OPTIONS http://localhost:8000/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST'
