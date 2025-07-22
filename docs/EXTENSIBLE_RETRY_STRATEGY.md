# Extensible Retry Strategy Architecture

## Overview

The retry strategy system has been redesigned to be highly extensible and maintainable. It follows the Strategy pattern and Factory pattern to allow easy addition of new backoff strategies without modifying existing code. Currently, the system defaults to exponential backoff for optimal performance and reliability.

## Architecture Components

### 1. Strategy Interface (`IBackoffStrategy`)

```typescript
interface IBackoffStrategy {
  calculateDelay(retryCount: number, config: RetryConfig): number;
  getName(): string;
}
```

All backoff strategies must implement this interface.

### 2. Built-in Strategy

#### Exponential Backoff (Default and Only Strategy)
- **Formula**: `baseDelay * multiplier^retryCount`
- **Use case**: All retry scenarios (universal solution)
- **Behavior**: Aggressive backoff, quickly increases delay
- **Benefits**:
  - Optimal for rate limiting and API throttling
  - Effective for network timeouts and temporary issues
  - Prevents system overload during outages
  - Proven reliability in production environments

#### VisibilityTimeout Integration
- **Purpose**: Coordinates retry timing with SQS message visibility
- **Formula**: `exponentialDelay * visibilityTimeoutMultiplier`
- **Behavior**: Adjusts delays to work optimally with SQS VisibilityTimeout (default 180 seconds)
- **Benefits**:
  - Prevents message duplication during retries
  - Optimizes SQS resource usage
  - Ensures proper retry coordination in distributed systems
  - Maintains message ordering and processing guarantees

### 3. Strategy Factory (`BackoffStrategyFactory`)

Manages strategy instances and provides:
- Strategy registration
- Strategy retrieval
- Strategy validation
- Extensibility support

### 4. Default Strategy Selection

The system uses exponential backoff as the default strategy for all scenarios:

```typescript
// Always returns exponential backoff regardless of error type
private selectStrategy(errorType?: string): RetryStrategyType {
  return RetryStrategyType.EXPONENTIAL;
}
```

This ensures consistent and proven retry behavior across all error types while maintaining the extensible architecture for future customizations.

### 5. Simplified Implementation

The current implementation uses only exponential backoff strategy, providing:
- **Optimal performance** for all retry scenarios
- **Proven reliability** in production environments
- **Effective rate limiting** protection
- **Consistent behavior** across all error types
- **Simplified maintenance** with single strategy focus
- **Extensible architecture** ready for future enhancements

## Usage Examples

### Basic Usage

```typescript
import { createRetryStrategy, RetryStrategyType } from '@/utils/retryStrategy';
import { sqsService } from '@/services/sqsService';

// Default exponential backoff (recommended)
const retryStrategy = createRetryStrategy({
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  jitterEnabled: true
});

// Exponential backoff with VisibilityTimeout integration
const visibilityTimeoutStrategy = createRetryStrategy({
  strategy: RetryStrategyType.EXPONENTIAL,
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  jitterEnabled: true,
  useVisibilityTimeout: true,
  visibilityTimeoutMultiplier: 1.2
});

// SQS-specific VisibilityTimeout strategy
await sqsService.sendTaskMessageWithVisibilityTimeout(taskPayload, {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2
});
```

### Advanced Usage with Automatic Retry

```typescript
const retryStrategy = createRetryStrategy({
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  jitterEnabled: true
});

// Execute operation with automatic retry and exponential backoff
await retryStrategy.executeWithRetry(async () => {
  // Your operation here - will automatically retry with exponential backoff
  return await apiCall();
}, {
  taskId: 'example',
  operationType: 'API_CALL'
});
```

## SQS VisibilityTimeout Strategy

### Overview

The VisibilityTimeout strategy integrates exponential backoff with SQS message visibility management for optimal retry coordination in distributed systems.

### How It Works

1. **Message Processing**: When a message fails processing, instead of immediately retrying, the system adjusts the message's VisibilityTimeout
2. **Coordinated Delays**: The visibility timeout is calculated using exponential backoff, ensuring the message becomes visible again at the optimal retry time
3. **Resource Optimization**: Prevents unnecessary polling and reduces SQS costs
4. **Distributed Coordination**: Ensures only one consumer processes the message at the calculated retry time

### Usage Examples

```typescript
import { sqsService } from '@/services/sqsService';

// Basic VisibilityTimeout retry
await sqsService.retryWithVisibilityTimeout(receiptHandle, retryCount, maxRetries);

// Change message visibility for custom retry timing
await sqsService.changeMessageVisibility(receiptHandle, retryCount);

// Get SQS retry configuration
const config = await sqsService.getSQSRetryConfig();

// Reset message visibility (make immediately available)
await sqsService.resetMessageVisibility(receiptHandle);
```

### Configuration

```typescript
// VisibilityTimeout settings in serverless.yml
Resources:
  TaskQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 180  # 3 minutes default
      MessageRetentionPeriod: 1209600  # 14 days

// Application configuration
const retryConfig = {
  useVisibilityTimeout: true,
  visibilityTimeoutMultiplier: 1.2,  // 20% buffer
  maxDelayMs: 144000  // 80% of 180 seconds
};
```

## Extending with Custom Strategies

### 1. Create Custom Strategy

```typescript
import { IBackoffStrategy, RetryConfig, RetryStrategyType } from '@/types';

export class CustomBackoffStrategy implements IBackoffStrategy {
  calculateDelay(retryCount: number, config: RetryConfig): number {
    // Your custom logic here
    return Math.min(customDelay, config.maxDelayMs);
  }

  getName(): string {
    return 'custom' as RetryStrategyType;
  }
}
```

### 2. Register Custom Strategy

```typescript
import { RetryStrategy } from '@/utils/retryStrategy';
import { CustomBackoffStrategy } from './customStrategy';

// Register the custom strategy
RetryStrategy.registerCustomStrategy(
  'custom' as RetryStrategyType,
  new CustomBackoffStrategy()
);

// Now you can use it
const customStrategy = createRetryStrategy({
  strategy: 'custom' as RetryStrategyType,
  maxRetries: 3,
  baseDelayMs: 1000
});
```

## Benefits

### 1. **Extensibility**
- Easy to add new strategies without modifying existing code
- Plugin-like architecture for custom strategies

### 2. **Maintainability**
- Clear separation of concerns
- Each strategy is self-contained
- Easy to test individual strategies

### 3. **Flexibility**
- Automatic strategy selection based on error types
- Runtime strategy switching
- Configuration-driven behavior

### 4. **Type Safety**
- Full TypeScript support
- Compile-time strategy validation
- IntelliSense support for all strategies

## Testing

The architecture includes comprehensive tests for:
- Individual strategy calculations
- Strategy factory functionality
- Integration with retry logic
- Custom strategy registration
- Error-based strategy selection

## Migration Guide

Existing code using the old retry system will continue to work. The default behavior remains exponential backoff, ensuring backward compatibility.

To take advantage of new features:
1. Update strategy configuration to use `RetryStrategyType` enum
2. Consider using error-based automatic strategy selection
3. Implement custom strategies for specific use cases
