# Load Balancer Testing Harness

This is an isolated testing harness to quickly boot up multiple service instances, run traffic through the API Gateway, and visualize the load balancer's behavior.

## Usage

### 1. Start Service Instances + Gateway

Run the load-test script to spin up instances dynamically (without permanently modifying any files) and the gateway:

```bash
# Start 20 Order Service instances with Round Robin
npm run test:lb -- order 20

# Start 30 User Service instances with Least Connections
npm run test:lb -- user 30 LEAST_CONNECTIONS

# Start 15 Product Service instances with Random strategy
npm run test:lb -- product 15 RANDOM
```

Press `Ctrl+C` to gracefully kill all child processes. 
If orphaned processes remain, run `npm run test:lb:stop`.

### 2. Send Sequential Requests

In a separate terminal, test the distribution:

```bash
# Send 100 requests sequentially
node test/send-requests.js order 100

# Send 100 requests using Consistent Hashing for a specific key
node test/send-requests.js order 100 CONSISTENT_HASHING user-123
```

### 3. Send Concurrent Requests

Good for testing race conditions or `LEAST_CONNECTIONS`:

```bash
# Send 100 requests concurrently
npm run test:concurrent -- order 100
```

### 4. One-Command Demo

To quickly spin up an environment, run tests, and show output:

```bash
npm run demo:lb
```
*(Demo script coordinates the spin-up and teardown automatically).*
