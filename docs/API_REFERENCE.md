# API Reference Guide

## 📖 Overview

The fault-tolerant task processing system provides a REST API for submitting tasks for asynchronous processing. The API is built on AWS API Gateway with comprehensive validation, error handling, and monitoring.

## 🌐 Base URL

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

**Example**:
```
https://abc123def.execute-api.us-east-1.amazonaws.com/dev
```

## 🔐 Authentication

Currently, the API does not require authentication. In production environments, consider implementing:
- API Keys
- AWS IAM authentication
- JWT tokens
- OAuth 2.0

## 📋 API Endpoints

### Submit Task

Submit a new task for asynchronous processing.

**Endpoint**: `POST /submit-task`

**Content-Type**: `application/json`

**Request Schema**:
```typescript
{
  taskId: string;           // Unique identifier for the task (required)
  payload: object;          // Task data (required)
}
```

**Validation Rules**:
- **taskId**: 1-255 characters, alphanumeric with hyphens and underscores only
- **payload**: Any JSON object, maximum size 256KB

**Success Response**: HTTP `201 Created` with task confirmation and queuing status.





**Error Responses**:
- **400 Bad Request**: Validation errors (invalid taskId, payload too large)
- **409 Conflict**: Duplicate task ID
- **500 Internal Server Error**: Server processing errors




## 📈 Rate Limiting

API Gateway enforces rate limiting with standard HTTP 429 responses when limits are exceeded.

## 🔧 CORS Configuration

The API supports Cross-Origin Resource Sharing (CORS) with the following configuration:

- **Allowed Origins**: `*` (configurable per environment)
- **Allowed Methods**: `POST, OPTIONS`
- **Allowed Headers**: `Content-Type, Authorization, X-Requested-With`
- **Max Age**: 86400 seconds (24 hours)



## 📊 Monitoring & Observability

### Request Tracking
Every request includes:
- **Request ID**: Unique identifier for tracing
- **Correlation ID**: For distributed tracing
- **Timestamp**: Request processing time
- **User Agent**: Client information

### Metrics Collected
- Request count by status code
- Response time percentiles
- Error rate by error type
- Payload size distribution

### Logging
All requests are logged with:
- Request/response details
- Processing duration
- Error information (if applicable)
- User context (if available)

## 🧪 Testing Tools

### Postman Collection
A Postman collection is available with pre-configured requests for all endpoints and failure scenarios.

### Load Testing
Use the provided test scripts for load testing:
```bash
# Basic load test
npm run test:load

# Custom load test
node scripts/test-system.js --count=100 --concurrency=20
```

### Health Check
Monitor API health using:
```bash
# Check API availability
curl -X OPTIONS https://your-api-endpoint/dev/submit-task

# Expected response: 200 OK with CORS headers
```