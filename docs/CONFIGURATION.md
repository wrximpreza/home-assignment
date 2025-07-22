# Configuration Reference

## 🔧 Overview

This guide provides comprehensive information about configuring the fault-tolerant task processing system, including environment variables, retry strategies, development tools, and stage-specific settings.

## 🛠️ Development Configuration

### Code Quality Tools
The project uses modern code quality tools with the following configuration:

- **ESLint** - Flat configuration format with Airbnb TypeScript rules
- **Prettier** - Consistent code formatting with 2-space indentation
- **TypeScript** - Strict type checking enabled
- **VS Code** - Pre-configured workspace settings and extensions

### NPM Scripts
| Script | Description | Usage |
|--------|-------------|-------|
| `code:check` | Check linting and formatting | `npm run code:check` |
| `code:fix` | Fix all code issues automatically | `npm run code:fix` |
| `validate` | Full project validation (lint + format + build + test) | `npm run validate` |
| `validate:fix` | Validate and fix issues | `npm run validate:fix` |
| `format` | Format code with Prettier | `npm run format` |
| `format:check` | Check code formatting | `npm run format:check` |
| `lint:check` | Check ESLint rules | `npm run lint:check` |
| `lint:fix` | Fix ESLint issues | `npm run lint:fix` |

## 🌍 Environment Variables

### Core System Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `STAGE` | Deployment stage (dev, staging, prod) | `dev` | Yes |
| `REGION` | AWS region for deployment | `us-east-1` | Yes |
| `TASK_QUEUE_URL` | SQS main queue URL | Auto-generated | Yes |
| `TASK_DLQ_URL` | SQS dead letter queue URL | Auto-generated | Yes |
| `TASK_TABLE_NAME` | DynamoDB table name | Auto-generated | Yes |

### AWS Powertools Configuration

| Variable | Description | Default | Stage Override |
|----------|-------------|---------|----------------|
| `POWERTOOLS_SERVICE_NAME` | Service name for logging | `fault-tolerant-service` | No |
| `POWERTOOLS_METRICS_NAMESPACE` | CloudWatch metrics namespace | `FaultTolerantService` | No |
| `POWERTOOLS_LOG_LEVEL` | Logging level | `INFO` | Yes |
| `POWERTOOLS_LOGGER_SAMPLE_RATE` | Log sampling rate | `0.1` | Yes |
| `POWERTOOLS_TRACER_CAPTURE_RESPONSE` | Capture response in traces | `true` | No |
| `POWERTOOLS_TRACER_CAPTURE_ERROR` | Capture errors in traces | `true` | No |
| `POWERTOOLS_METRICS_CAPTURE_COLD_START` | Capture cold start metrics | `true` | No |

### Processing Configuration

| Variable | Description | Default | Stage Override |
|----------|-------------|---------|----------------|
| `FAILURE_RATE` | Simulated failure rate (0.0-1.0) | `0.3` | Yes |
| `PROCESSING_TIME_MS` | Task processing time | `2000` | No |

## ⚙️ Stage-Specific Configuration

### Development Stage (`dev`)
```yaml
custom:
  logLevel:
    dev: DEBUG
  logSampleRate:
    dev: '1.0'  # Log all requests
  failureRate:
    dev: 0.3    # 30% failure rate for extensive testing
```

## 🔄 Retry Strategy Configuration

### Default Retry Configuration
```typescript
export const retryConfig: RetryConfig = {
  maxRetries: 2,              // Maximum retry attempts
  baseDelayMs: 1000,          // Base delay (1 second)
  maxDelayMs: 30000,          // Maximum delay (30 seconds)
  backoffMultiplier: 2,       // Exponential backoff multiplier
  jitterEnabled: true,        // Enable jitter to prevent thundering herd
  strategy: 'exponential',    // Retry strategy (only exponential supported)
};
```

### Retry Strategy

#### Exponential Backoff (Only Supported Strategy)
```typescript
{
  strategy: 'exponential',
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000
}
```
- **Formula**: `baseDelay * multiplier^retryCount`
- **Use Case**: Rate limiting, service overload scenarios, network timeouts
- **Example Delays**: 1s → 2s → 4s → 8s...
- **Jitter**: Optional random delay (default 500ms max) to prevent thundering herd
### Jitter Configuration

Jitter is automatically applied when `jitterEnabled: true` to prevent thundering herd problems:
- **Default Jitter**: Random delay up to 500ms added to calculated delay
- **Formula**: `calculatedDelay + random(0, 500)`
- **Purpose**: Prevents synchronized retries across multiple clients

### Custom Metrics Namespace
```yaml
environment:
  POWERTOOLS_METRICS_NAMESPACE: FaultTolerantService
```

## 📚 Configuration Best Practices

### Security
- Use least privilege IAM roles
- Enable encryption for all data stores
- Rotate credentials regularly
- Use AWS Secrets Manager for sensitive data

### Performance
- Right-size Lambda memory allocation
- Optimize timeout settings
- Use provisioned concurrency for critical functions
- Monitor and adjust based on metrics

### Cost Management
- Use on-demand billing for variable workloads
- Set appropriate log retention periods
- Monitor costs with AWS Cost Explorer
- Use reserved capacity for predictable workloads

### Monitoring
- Enable X-Ray tracing for all functions
- Set up comprehensive CloudWatch alarms
- Use structured logging for better analysis
- Implement custom metrics for business logic
