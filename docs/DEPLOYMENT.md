# Deployment Guide

## 🚀 Overview

This guide provides step-by-step instructions for deploying the fault-tolerant task processing system to AWS. The system uses serverless architecture with automated deployment scripts for multiple environments.

## 📋 Prerequisites

### Required Software
1. **Node.js 20.x or later** - [Download](https://nodejs.org/)
2. **AWS CLI** - [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
3. **Serverless Framework** - Install globally: `npm install -g serverless`

### AWS Account Setup
1. **AWS Account** with appropriate permissions
2. **IAM User** with the following policies:
   - `AWSLambdaFullAccess`
   - `AmazonAPIGatewayAdministrator`
   - `AmazonSQSFullAccess`
   - `AmazonDynamoDBFullAccess`
   - `CloudWatchFullAccess`
   - `IAMFullAccess` (for role creation)

### AWS CLI Configuration
```bash
# Configure AWS credentials
aws configure

# Or use AWS profiles
aws configure --profile your-profile-name
export AWS_PROFILE=your-profile-name

# Verify configuration
aws sts get-caller-identity
```

## 🛠️ Installation

### 1. Clone and Setup
```bash
# Clone the repository
git clone <repository-url>
cd fault-tolerant-service

# Install dependencies
npm install

# Verify setup
npm run build
npm run lint
```

### 2. Environment Configuration
Create environment-specific configuration files if needed:

```bash
# Optional: Create custom configuration
cp serverless.yml serverless.custom.yml
# Edit serverless.custom.yml for custom settings
```

## 🚀 Deployment Options

### Option 1: Automated Deployment Scripts (Recommended)

Use the provided deployment scripts or npm commands to deploy to different environments.

## 🏗️ Deployment Stages

### Development (`dev`)
**Purpose**: Development and testing
**Configuration**:
- Verbose logging (DEBUG level)
- Relaxed timeouts
- Cost-optimized settings

### Staging (`staging`)
**Purpose**: Pre-production testing
**Configuration**:
- Production-like settings
- Moderate logging (INFO level)
- Performance testing ready

### Production (`prod`)
**Purpose**: Live production environment
**Configuration**:
- Optimized performance
- Minimal logging (WARN level)
- Enhanced monitoring

## ✅ Post-Deployment Verification

### Verification
After deployment, test the API endpoint and run the test suite to verify functionality.

## 🔧 Configuration Options

### Environment Variables
The system uses the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `STAGE` | Deployment stage | `dev` |
| `REGION` | AWS region | `us-east-1` |
| `TASK_QUEUE_URL` | SQS main queue URL | Auto-generated |
| `TASK_DLQ_URL` | SQS dead letter queue URL | Auto-generated |
| `TASK_TABLE_NAME` | DynamoDB table name | Auto-generated |
| `FAILURE_RATE` | Simulated failure rate | `0.3` (30%) |

### Custom Configuration
Edit `serverless.yml` for custom settings:

```yaml
custom:
  failureRate:
    dev: 0.3      # 30% for extensive testing
    staging: 0.3  # 30% for realistic testing
    prod: 0.3     # 30% for production

  logLevel:
    dev: DEBUG
    staging: INFO
    prod: WARN
```

## 📊 Monitoring Setup

### CloudWatch Dashboards
Automatically created dashboards include:
- System health overview
- Task processing metrics
- Queue depth monitoring
- Error rate analysis

### CloudWatch Alarms
Default alarms are configured for:
- DLQ message alerts
- High error rates (>50%)
- Queue depth alerts (>100 messages)
- Lambda function errors

### X-Ray Tracing
Distributed tracing is enabled by default for:
- End-to-end request tracking
- Performance bottleneck identification
- Error correlation across services

## 🚨 Troubleshooting

### Common Deployment Issues

#### 1. Permission Errors
```bash
aws iam list-attached-user-policies --user-name your-username
```

#### 2. Region Mismatch
```bash
aws configure get region
```

#### 3. Build Failures
```bash
npm run lint:fix
npm run build
```

### Debug Commands
```bash
# Check CloudFormation stack status
aws cloudformation describe-stacks --stack-name fault-tolerant-service-dev

# View Lambda function logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/fault-tolerant-service"

# Check SQS queue attributes
aws sqs get-queue-attributes --queue-url "your-queue-url" --attribute-names All

# Verify DynamoDB table
aws dynamodb describe-table --table-name fault-tolerant-service-dev-tasks
```

## 🧹 Cleanup and Removal

### Remove Deployment
```bash
# Using deployment script
./scripts/deploy.sh --remove --stage dev

# Using npm script
npm run remove

# Using Serverless directly
serverless remove --stage dev --region us-east-1
```

### Manual Cleanup
If automatic removal fails:
1. Delete CloudFormation stack manually
2. Remove S3 deployment bucket
3. Delete CloudWatch log groups
4. Clean up any remaining resources

## 💰 Cost Optimization

### Development Environment
- Use on-demand billing for DynamoDB
- Set short log retention periods (7 days)
- Use minimal Lambda memory allocation (512MB)
- Enable cost allocation tags

### Production Environment
- Consider reserved capacity for predictable workloads
- Optimize Lambda memory and timeout settings
- Set appropriate log retention policies (30 days)
- Monitor costs with AWS Cost Explorer

## 🔒 Security Considerations

### IAM Best Practices
- Use least privilege access for all roles
- Separate roles for different functions
- Regular audit of permissions
- Enable CloudTrail for audit logging

### Network Security
- Optional VPC deployment for network isolation
- Security groups for restrictive access
- WAF integration for API Gateway protection

### Data Protection
- Encryption at rest for DynamoDB and SQS
- Encryption in transit for all communications
- Sensitive data redaction in logs
- Regular security assessments

## 📚 Next Steps

After successful deployment:
1. Review the [Testing Guide](TESTING.md) for comprehensive validation
2. Check the [API Reference](API_REFERENCE.md) for integration details
3. Monitor system health using CloudWatch dashboards
4. Set up additional alerting based on your requirements

For ongoing maintenance and monitoring, refer to the [Architecture Guide](ARCHITECTURE.md) for detailed system understanding.
