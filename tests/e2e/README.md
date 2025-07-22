# End-to-End (E2E) Tests

This directory contains comprehensive end-to-end tests for the fault-tolerant task processing system. These tests validate the complete AWS infrastructure and application workflow.

## Test Suites

### 1. Comprehensive AWS Flow Tests (`comprehensive-aws-flow-test.cjs`)

**Purpose**: Tests the complete task processing workflow from submission to completion/failure.

**What it tests**:
- ✅ Basic task submission through API Gateway
- ✅ Task processing via Lambda functions
- ✅ Retry mechanism with proper retry counts
- ✅ Dead Letter Queue (DLQ) functionality
- ✅ Database record accuracy and completeness
- ✅ 30% failure rate accuracy
- ✅ Queue health and monitoring

**Key validations**:
- API returns correct status codes and responses
- Tasks are stored in DynamoDB with all required fields
- Retry counts are tracked accurately (0, 1, 2)
- Failed tasks end up in DLQ after max retries
- Database records maintain data integrity

### 2. DLQ and Error Handling Tests (`dlq-error-handling-test.cjs`)

**Purpose**: Specifically validates Dead Letter Queue functionality and error propagation.

**What it tests**:
- ✅ DLQ message structure and format validation
- ✅ Error propagation from Lambda to database
- ✅ DLQ monitoring and metrics collection
- ✅ Retry exhaustion scenarios
- ✅ Message attributes preservation

**Key validations**:
- DLQ messages contain correct taskId, payload, and retry count
- Error messages are properly recorded in database
- Tasks reach maximum retry count before going to DLQ
- DLQ can be monitored for message counts and attributes

### 3. Database Validation Tests (`database-validation-test.cjs`)

**Purpose**: Validates database record accuracy, consistency, and integrity.

**What it tests**:
- ✅ Database record completeness (all required fields)
- ✅ Retry count accuracy and progression
- ✅ Status transitions and timestamp validation
- ✅ Data integrity across the entire workflow
- ✅ Field type validation and constraints

**Key validations**:
- All required fields are present and correctly typed
- Retry counts progress logically (0 → 1 → 2)
- Status transitions follow valid patterns
- Timestamps are consistent and logical
- Data integrity is maintained at >90% accuracy

### 4. DTO Validation Tests (`dto-validation-test.cjs`)

**Purpose**: Validates request and response DTO validation using Zod schemas.

**What it tests**:
- ✅ Valid request validation and processing
- ✅ Invalid request rejection with proper error messages
- ✅ JSON parsing error handling
- ✅ Response structure validation
- ✅ Field type and constraint validation

**Key validations**:
- Valid requests are processed successfully
- Invalid requests return 400 status with descriptive errors
- Malformed JSON is properly rejected
- Response DTOs match expected structure
- All validation rules are enforced

## Running the Tests

### Run All Tests
```bash
# Run all E2E test suites in sequence
node tests/e2e/run-all-tests.cjs
```

### Run Individual Test Suites
```bash
# Run comprehensive flow tests
node tests/e2e/comprehensive-aws-flow-test.cjs

# Run DLQ and error handling tests
node tests/e2e/dlq-error-handling-test.cjs

# Run database validation tests
node tests/e2e/database-validation-test.cjs

# Run DTO validation tests
node tests/e2e/dto-validation-test.cjs
```

## Test Data Cleanup

All E2E tests automatically clean up test data before starting to ensure a clean state. The cleanup process:

- ✅ **DynamoDB**: Removes all existing task records
- ✅ **SQS Queues**: Purges main queue and DLQ
- ✅ **Graceful Handling**: Skips cleanup if resources don't exist
- ✅ **Error Recovery**: Continues tests even if cleanup fails

### Manual Cleanup
```bash
# Run cleanup manually
node tests/e2e/utils/database-cleanup.cjs
```

## Prerequisites

### AWS Configuration
- AWS credentials configured (via AWS CLI, environment variables, or IAM roles)
- Access to the deployed AWS resources:
  - API Gateway endpoint
  - DynamoDB table
  - SQS queues (main queue and DLQ)
  - Lambda functions

### Environment Setup
- Node.js 18+ installed
- Required npm packages installed (`npm install`)
- Network connectivity to AWS services

### AWS Resources
The tests expect the following AWS resources to be deployed:
- **API Gateway**: `https://fd0yhfwaaf.execute-api.us-east-1.amazonaws.com/dev`
- **DynamoDB Table**: `fault-tolerant-service-dev`
- **SQS Queue**: `fault-tolerant-service-task-queue-dev`
- **DLQ**: `fault-tolerant-service-task-dlq-dev`

## Test Configuration

### Failure Rate Testing
The tests use deterministic failure patterns:
- Tasks with indices 0, 3, 6 (mod 10) are designed to fail
- This creates exactly 30% failure rate for systematic testing

### Retry Configuration
- Maximum retries: 2 (total 3 attempts)
- SQS `maxReceiveCount`: 3
- Retry counts tracked: 0, 1, 2

### Timeouts and Waits
- Initial processing wait: 15-20 seconds
- Retry completion wait: 45-60 seconds
- DLQ delivery wait: 60-75 seconds

## Expected Results

### Success Criteria
- ✅ All test suites pass (exit code 0)
- ✅ >90% test case success rate within each suite
- ✅ Retry counts reach maximum of 2
- ✅ DLQ receives failed messages
- ✅ Database maintains >90% data integrity

### Common Issues and Troubleshooting

#### AWS Connectivity Issues
```
Error: getaddrinfo ENOTFOUND
```
**Solution**: Check network connectivity and AWS endpoint accessibility

#### Permission Issues
```
Error: AccessDenied
```
**Solution**: Verify AWS credentials have necessary permissions for DynamoDB, SQS, and API Gateway

#### Resource Not Found
```
Error: ResourceNotFoundException
```
**Solution**: Ensure all AWS resources are deployed and accessible

#### Timeout Issues
```
Test timeouts or incomplete processing
```
**Solution**: Check Lambda function logs and increase wait times if needed

## Monitoring and Debugging

### CloudWatch Logs
Monitor Lambda function logs for detailed execution information:
```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/fault-tolerant-service-dev-processTask" \
  --start-time $(date -d '1 hour ago' +%s)000
```

### DynamoDB Inspection
Check database records directly:
```bash
aws dynamodb scan \
  --table-name fault-tolerant-service-dev \
  --filter-expression "createdAt > :timestamp" \
  --expression-attribute-values '{":timestamp":{"S":"2025-01-01T00:00:00.000Z"}}'
```

### SQS Queue Monitoring
Check queue message counts:
```bash
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-queue-dev" \
  --attribute-names ApproximateNumberOfMessages
```

## Test Data Cleanup

The tests create temporary data that can be cleaned up:

### DynamoDB Cleanup
Test tasks are created with TTL and will auto-expire, but can be manually cleaned:
```bash
# Scan and delete test tasks (be careful with this command)
aws dynamodb scan --table-name fault-tolerant-service-dev \
  --filter-expression "contains(taskId, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"test-"}}'
```

### SQS Cleanup
DLQ messages can be purged if needed:
```bash
aws sqs purge-queue \
  --queue-url "https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-dlq-dev"
```

## Contributing

When adding new E2E tests:
1. Follow the existing test structure and naming conventions
2. Include comprehensive assertions and error handling
3. Add appropriate wait times for AWS eventual consistency
4. Update this README with new test descriptions
5. Ensure tests are idempotent and don't interfere with each other
