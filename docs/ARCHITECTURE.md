# System Architecture Guide

## 🏗️ Overview

The fault-tolerant task processing system is built on a serverless, event-driven architecture using AWS services. The system demonstrates enterprise-grade fault tolerance, comprehensive monitoring, and scalable design patterns.

## 🎯 Design Principles

### Fault Tolerance
- **Graceful Degradation**: System continues operating even when components fail
- **Exponential Backoff**: Smart retry mechanisms prevent thundering herd problems
- **Circuit Breaker Patterns**: Prevent cascade failures across services
- **Dead Letter Queue**: Comprehensive handling and monitoring of failed tasks

### Scalability
- **Serverless Architecture**: Auto-scaling based on demand
- **Event-Driven Design**: Asynchronous processing for high throughput
- **Stateless Components**: Lambda functions scale independently
- **Queue-Based Processing**: Decoupled components for better resilience

### Observability
- **Structured Logging**: Consistent JSON logging with correlation IDs
- **Custom Metrics**: Business and operational metrics in CloudWatch
- **Distributed Tracing**: X-Ray integration for end-to-end visibility
- **Real-time Monitoring**: Comprehensive alerting and dashboards

### Security
- **Least Privilege**: IAM roles with minimal required permissions
- **Data Encryption**: At rest and in transit across all services
- **Input Validation**: Comprehensive validation using Zod schemas with custom middleware
- **Audit Trail**: Complete operational logging for compliance

## 🏛️ High-Level Architecture

![Architecture Diagram](architcture.png)

## 🔧 Core Components

### 1. API Gateway
**Purpose**: REST API endpoint for task submission

**Configuration**:
- CORS enabled for cross-origin requests
- Request/response validation
- Throttling and rate limiting
- Integration with Lambda functions

**Key Features**:
- HTTP method validation (POST only for task submission)
- Request size limits and validation
- Error response standardization
- CloudWatch logging integration

### 2. Submit Task Lambda
**Purpose**: Handles task submission, validation, and queuing

**Responsibilities**:
- Input validation using Zod schemas with custom middleware
- Task ID uniqueness verification
- DynamoDB record creation
- SQS message queuing
- Error handling and response formatting

**Middleware Stack**:
- **CORS Middleware**: Cross-origin request handling
- **JSON Body Parser**: Automatic request body parsing
- **Validation Middleware**: Zod schema validation for requests/responses
- **Error Handler**: Standardized error response formatting
- **AWS Powertools**: Logging, metrics, and tracing integration

**Configuration**:
- Runtime: Node.js 20.x
- Memory: 512MB
- Timeout: 30 seconds
- Environment variables for queue and table URLs

### 3. SQS Main Queue
**Purpose**: Reliable message queuing for asynchronous task processing

**Configuration**:
- Visibility timeout: 180 seconds
- Message retention: 14 days
- Redrive policy: Max 3 retries before DLQ
- FIFO ordering for consistent processing

**Key Features**:
- Automatic retry mechanism
- Dead letter queue integration
- Batch processing support
- Message deduplication

### 4. Process Task Lambda
**Purpose**: Core task processing with failure simulation and retry logic

**Responsibilities**:
- Task processing with 30% simulated failure rate
- Exponential backoff retry implementation
- DynamoDB status updates
- Error classification and handling
- CloudWatch metrics publishing

**Configuration**:
- Runtime: Node.js 20.x
- Memory: 512MB
- Timeout: 180 seconds
- SQS batch processing (up to 10 messages)

### 5. Dead Letter Queue (DLQ)
**Purpose**: Stores tasks that failed after maximum retry attempts

**Configuration**:
- Message retention: 14 days
- No redrive policy (terminal queue)
- Triggers DLQ monitor Lambda

**Key Features**:
- Automatic failure capture
- Comprehensive error logging
- Analytics and reporting
- Manual reprocessing capability

### 6. DLQ Monitor Lambda
**Purpose**: Processes and analyzes failed tasks for monitoring and alerting

**Responsibilities**:
- Failed task analysis and categorization
- Comprehensive logging with error classification
- CloudWatch metrics publishing
- Alert generation for critical failures
- Sensitive data redaction

**Error Classification**:
- **VALIDATION**: Input validation failures (non-retryable)
- **NETWORK**: Connection timeouts, network failures (retryable)
- **RATE_LIMIT**: API rate limiting, throttling (retryable with backoff)
- **SYSTEM**: Internal server errors, database failures (retryable)
- **UNKNOWN**: Unclassified errors requiring investigation

### 7. DynamoDB Table
**Purpose**: Task state management and audit trail

**Schema**: Task records with status tracking, timestamps, retry counts, and error information.

**Configuration**:
- On-demand billing mode
- Encryption at rest enabled
- Point-in-time recovery enabled
- CloudWatch integration for metrics

### 8. Middleware Layer
**Purpose**: Standardized request/response processing using Middy.js

**Key Components**:
- **Validation**: Zod schema validation for requests/responses
- **CORS**: Cross-origin request handling
- **Error Handling**: Centralized error processing
- **AWS Powertools**: Logging, metrics, and tracing

### 9. CloudWatch Integration
**Purpose**: Comprehensive monitoring, logging, and alerting

**Components**:
- **Log Groups**: Structured logging for all Lambda functions
- **Custom Metrics**: Task processing metrics and DLQ analytics
- **Dashboards**: Real-time system health visualization
- **Alarms**: Automated alerting for critical issues

## 🔄 Data Flow

### Data Flow
1. **Task Submission**: API Gateway → Submit Lambda → DynamoDB + SQS
2. **Task Processing**: SQS → Process Lambda → DynamoDB (with retry logic)
3. **DLQ Monitoring**: DLQ → Monitor Lambda → CloudWatch (error analysis)

## ⚡ Failure Scenarios & Handling

### Transient Failures (Retryable)
**Examples**: Network timeouts, service unavailable, throttling
**Handling**: 
- Exponential backoff retry (1s, 2s, 4s delays)
- Maximum 2 retry attempts
- Jitter to prevent thundering herd
- Eventual DLQ placement if all retries fail

### Permanent Failures (Non-Retryable)**Examples**: Validation errors, malformed data
**Handling**:
- Immediate failure without retry
- Direct placement in DLQ
- Error classification as VALIDATION
- Detailed logging for debugging

### Processing Failures (Simulated)
**Examples**: Random 30% failure rate for testing
**Handling**:
- Standard retry logic applies
- Error classification as SYSTEM
- Comprehensive metrics collection
- DLQ placement after max retries

## 📊 Monitoring Strategy

### Key Metrics
- **Task Processing**: Success/failure rates, processing duration
- **Queue Health**: Queue depths, message age, processing rates
- **DLQ Analytics**: Error categorization, retry patterns, failure trends
- **System Performance**: Lambda duration, cold starts, memory usage

### Dashboards
- **System Overview**: High-level health and performance metrics
- **Task Processing**: Detailed processing metrics and trends
- **Error Analysis**: DLQ analytics and error categorization
- **Performance**: Response times, throughput, and resource utilization


## 🚀 Scalability Considerations

### Auto-Scaling
- **Lambda Concurrency**: Automatic scaling based on queue depth
- **DynamoDB**: On-demand scaling for read/write capacity
- **SQS**: Unlimited message capacity with automatic scaling

### Performance Optimization
- **Lambda Memory**: Optimized memory allocation for performance
- **Connection Pooling**: Reused connections for AWS services
- **Cold Start Mitigation**: Provisioned concurrency for critical functions

### Cost Optimization
- **On-Demand Billing**: Pay-per-use model for all services
- **Log Retention**: Configurable retention periods
- **Resource Right-Sizing**: Optimized memory and timeout settings

## 🔧 Configuration Management

### Environment Variables
- **STAGE**: Deployment environment (dev, staging, prod)
- **REGION**: AWS region for deployment
- **TASK_QUEUE_URL**: SQS main queue URL
- **TASK_DLQ_URL**: SQS dead letter queue URL
- **TASK_TABLE_NAME**: DynamoDB table name

### Stage-Specific Configuration
- **Development**: Verbose logging, relaxed timeouts, cost optimization
- **Staging**: Production-like settings, moderate logging
- **Production**: Optimized performance, minimal logging, enhanced monitoring
