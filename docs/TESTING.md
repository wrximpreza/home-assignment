# Testing Guide

## 🧪 Overview

This guide covers testing the fault-tolerant task processing system, including failure simulation and performance testing.

## 📋 Test Scenarios

### 1. Valid Task Processing
Tests successful API calls with proper response validation and task completion.

### 2. Failure Simulation Testing
The system includes failure simulation for testing fault tolerance mechanisms.

#### Rate Limiting Simulation (Retryable with backoff)
```bash
curl -X POST https://your-api-endpoint/dev/submit-task \
  -H 'Content-Type: application/json' \
  -d '{
    "taskId": "fail-rate-limit-001",
    "payload": {
      "simulateFailure": "rate_limit"
    }
  }'
```

#### System Error Simulation (Retryable)
```bash
curl -X POST https://your-api-endpoint/dev/submit-task \
  -H 'Content-Type: application/json' \
  -d '{
    "taskId": "fail-system-001",
    "payload": {
      "simulateFailure": "system_error"
    }
  }'
```

### 3. Edge Case Testing

#### Large Payload Test
```bash
curl -X POST https://your-api-endpoint/dev/submit-task \
  -H 'Content-Type: application/json' \
  -d '{
    "taskId": "edge-large-001",
    "payload": {
      "data": "'$(printf 'x%.0s' {1..1000})'"
    }
  }'
```

### 4. Concurrent Load Testing

```bash
# Test with 100 tasks and 20 concurrent connections
node scripts/test-system.js \
  --endpoint="https://your-api.com/dev" \
  --count=100 \
  --concurrency=20
```

## 📊 Key Performance Indicators
- **Success Rate**: ≥80% (including intentional 30% failure simulation)
- **Response Time**: <5 seconds (95th percentile)
- **Throughput**: >100 tasks/minute
- **Error Recovery**: 100% of failed tasks properly classified and logged in DLQ

## 🔍 Monitoring During Tests

```bash
# Monitor Lambda logs
aws logs tail /aws/lambda/fault-tolerant-service-dev-submitTask --follow

# Check SQS queue depth
aws sqs get-queue-attributes \
  --queue-url "your-queue-url" \
  --attribute-names ApproximateNumberOfMessages
```

## 🧪 Advanced Testing Scenarios

### Core Functionality Tests
- Valid Task Submission
- Invalid Task Submissions
- Duplicate Task Submission

### Fault Tolerance Tests
- Network Timeout Simulation
- Validation Error Handling
- Rate Limiting Simulation

## 🛠️ Test Scripts

- **`scripts/test-system.js`** - Main Node.js test script

