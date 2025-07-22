# CI/CD Pipeline Documentation

## Overview

This document describes the Continuous Integration and Continuous Deployment (CI/CD) pipeline for the fault-tolerant task processing system. The pipeline is built using GitHub Actions and provides automated testing, security scanning, and deployment across multiple environments.

## Pipeline Architecture

### Workflow Structure

The CI/CD pipeline consists of three main workflows:

1. **CI Pipeline** (`.github/workflows/ci.yml`) - Runs on every push and pull request
2. **Deploy Pipeline** (`.github/workflows/deploy.yml`) - Handles deployments to different environments
3. **Security and Maintenance** (`.github/workflows/security-and-maintenance.yml`) - Daily security scans and maintenance tasks

### Environment Strategy

- **Development** - Automatic deployment from `develop` branch
- **Staging** - Automatic deployment from `develop` branch with additional validation
- **Production** - Automatic deployment from `main` branch with approval gates

## CI Pipeline

### Triggered On
- Manual workflow dispatch with configurable options
- Pull requests to `main` or `develop` branches

### Jobs

#### 1. Lint and Format Check
- Runs ESLint for code quality
- Validates Prettier formatting
- Ensures code style consistency

#### 2. TypeScript Type Check
- Compiles TypeScript code
- Validates type safety
- Catches compilation errors early

#### 3. Unit Tests
- Executes Jest unit tests
- Generates code coverage reports
- Uploads coverage to Codecov

#### 4. Integration Tests
- Runs integration test suite
- Validates component interactions
- Tests service integrations

#### 5. Security Scan
- Performs npm audit for vulnerabilities
- Runs Snyk security analysis
- Identifies security issues in dependencies

#### 6. Build Validation
- Compiles the project
- Validates Serverless configuration
- Packages deployment artifacts
- Uploads build artifacts for deployment

## Deploy Pipeline

### Triggered On
- Manual workflow dispatch with environment selection
- Optional test execution before deployment
- Force deployment option to bypass test failures

### Environment Selection
The pipeline uses manual environment selection:
- User selects target environment (dev/staging/prod)
- Optional test execution before deployment
- Force deployment option available

### Pre-Deployment Validation
Before any deployment, the pipeline runs:
- Code linting
- Unit tests
- Integration tests
- Security scans (for staging/production)

### Deployment Jobs

#### Development Deployment
- **Triggers**: Manual selection
- **Requirements**: Optional tests (configurable)
- **Post-deployment**: Smoke tests

#### Staging Deployment
- **Triggers**: Manual selection
- **Requirements**: Optional tests (configurable)
- **Post-deployment**: E2E tests + performance validation

#### Production Deployment
- **Triggers**: Manual selection
- **Requirements**: Optional tests (configurable) + manual approval
- **Post-deployment**: Health checks + monitoring validation
- **Additional**: Creates deployment tags

### Deployment Process

1. **Environment Setup**
   - Configure AWS credentials
   - Set environment variables
   - Install dependencies

2. **Deployment Execution**
   - Run `serverless deploy` for target stage
   - Extract API endpoint URL
   - Validate deployment success

3. **Post-Deployment Validation**
   - Execute environment-specific tests
   - Validate service health
   - Monitor for immediate issues

## Security and Maintenance

### Manual Security Tasks

#### 1. Dependency Security Audit
- Scans for vulnerable dependencies
- Generates audit reports
- Fails on high/critical vulnerabilities

#### 2. Snyk Security Scan
- Advanced vulnerability detection
- License compliance checking
- Generates detailed security reports

#### 3. CodeQL Analysis
- Static code analysis
- Security vulnerability detection
- Automated security issue reporting

#### 4. Dependency Update Check
- Identifies outdated dependencies
- Creates GitHub issues for updates
- Provides update recommendations

#### 5. License Compliance
- Validates dependency licenses
- Identifies problematic licenses
- Generates compliance reports

#### 6. Infrastructure Drift Detection
- Monitors infrastructure changes
- Detects configuration drift
- Alerts on unexpected modifications

## Manual Workflow Execution

### How to Trigger Workflows

All workflows are configured to run manually through GitHub's workflow dispatch feature:

#### 1. CI Pipeline
1. Go to **Actions** tab in your GitHub repository
2. Select **CI Pipeline** workflow
3. Click **Run workflow**
4. Configure options:
   - **Run security scan**: Enable/disable security scanning
   - **Run integration tests**: Enable/disable integration tests
5. Click **Run workflow** to start

#### 2. Deploy Pipeline
1. Go to **Actions** tab in your GitHub repository
2. Select **Deploy Pipeline** workflow
3. Click **Run workflow**
4. Configure deployment:
   - **Environment**: Select dev/staging/prod
   - **Force deployment**: Bypass test failures if needed
   - **Run tests**: Enable/disable pre-deployment tests
5. Click **Run workflow** to start

#### 3. Security and Maintenance
1. Go to **Actions** tab in your GitHub repository
2. Select **Security and Maintenance** workflow
3. Click **Run workflow**
4. Configure security tasks:
   - **Run dependency audit**: Check for vulnerable dependencies
   - **Run Snyk scan**: Advanced security scanning
   - **Run CodeQL**: Static code analysis
   - **Check dependency updates**: Find outdated packages
   - **Run license check**: Validate license compliance
5. Click **Run workflow** to start

### Workflow Permissions

Ensure your GitHub repository has the following permissions configured:
- **Actions**: Read and write permissions
- **Contents**: Read permissions
- **Security events**: Write permissions (for CodeQL)
- **Pull requests**: Write permissions (for PR checks)

## Environment Configuration

### GitHub Environments Setup

The CI/CD pipeline uses GitHub environments to provide deployment protection, approval workflows, and environment-specific configuration. Each deployment stage has a corresponding GitHub environment with specific protection rules.

#### Manual Setup

To set up environments manually:

1. Go to **Settings** → **Environments** in your GitHub repository
2. Click **New environment**
3. Configure protection rules as specified below
4. Add environment variables and secrets

### Environment Configuration Details

Each deployment stage has a corresponding GitHub environment with specific protection rules:

#### Development
- **Protection**: No reviewers required
- **Deploy**: Manual trigger only
- **Validation**: Optional tests

#### Staging
- **Protection**: 1 reviewer required
- **Deploy**: Manual trigger only
- **Validation**: Optional tests + security scans

#### Production
- **Protection**: 2 reviewers required + 5-minute wait
- **Deploy**: Manual trigger only
- **Validation**: Optional tests + complete validation suite

### Environment Variables

Each GitHub environment includes pre-configured variables:

#### Development Environment Variables
- `AWS_REGION`: us-east-1
- `STAGE`: dev
- `LOG_LEVEL`: DEBUG
- `FAILURE_RATE`: 0.3
- `POWERTOOLS_LOG_LEVEL`: DEBUG
- `POWERTOOLS_LOGGER_SAMPLE_RATE`: 1.0

#### Staging Environment Variables
- `AWS_REGION`: us-east-1
- `STAGE`: staging
- `LOG_LEVEL`: INFO
- `FAILURE_RATE`: 0.3
- `POWERTOOLS_LOG_LEVEL`: INFO
- `POWERTOOLS_LOGGER_SAMPLE_RATE`: 0.5

#### Production Environment Variables
- `AWS_REGION`: us-east-1
- `STAGE`: prod
- `LOG_LEVEL`: WARN
- `FAILURE_RATE`: 0.3
- `POWERTOOLS_LOG_LEVEL`: WARN
- `POWERTOOLS_LOGGER_SAMPLE_RATE`: 0.1

### Environment Protection Rules

#### Development
- **Wait Timer**: None
- **Required Reviewers**: None
- **Prevent Self Review**: Disabled
- **Deployment Branches**: Any branch

#### Staging
- **Wait Timer**: None
- **Required Reviewers**: 1 reviewer required
- **Prevent Self Review**: Enabled
- **Deployment Branches**: Any branch

#### Production
- **Wait Timer**: 5 minutes (300 seconds)
- **Required Reviewers**: 2 reviewers required
- **Prevent Self Review**: Enabled
- **Deployment Branches**: Any branch

### Environment Secrets Management

After creating the environments, you need to add secrets to each environment. Secrets are encrypted and only available to workflows running in that specific environment.

#### How to Add Environment Secrets

1. **Navigate to Environment Settings**
   - Go to your repository → **Settings** → **Environments**
   - Click on the environment name (development/staging/production)
   - Scroll down to **Environment secrets**
   - Click **Add secret**

2. **Add Required Secrets**
   - Enter the secret name and value
   - Click **Add secret** to save

#### Required Secrets by Environment

Configure these secrets for each environment:

#### Development Environment
```
AWS_ACCESS_KEY_ID_DEV
AWS_SECRET_ACCESS_KEY_DEV
AWS_REGION_DEV (optional, defaults to us-east-1)
```

#### Staging Environment
```
AWS_ACCESS_KEY_ID_STAGING
AWS_SECRET_ACCESS_KEY_STAGING
AWS_REGION_STAGING (optional, defaults to us-east-1)
```

#### Production Environment
```
AWS_ACCESS_KEY_ID_PROD
AWS_SECRET_ACCESS_KEY_PROD
AWS_REGION_PROD (optional, defaults to us-east-1)
```

#### Optional Secrets
```
SNYK_TOKEN - For enhanced security scanning
CODECOV_TOKEN - For code coverage reporting
SLACK_WEBHOOK_URL - For deployment notifications
PAGERDUTY_INTEGRATION_KEY - For production alerts
```

### Environment Deployment Tracking

GitHub environments provide deployment tracking and history:

#### Deployment URLs
Each successful deployment automatically captures the API endpoint URL, making it easy to:
- Access the deployed application
- Run post-deployment tests
- Monitor application health
- Share environment URLs with team members

#### Deployment History
View deployment history for each environment:
1. Go to **Actions** tab in your repository
2. Click on any deployment workflow run
3. View environment-specific deployment details
4. Access deployment URLs and logs

#### Environment Status
Monitor environment status:
- **Active**: Environment is currently deployed and running
- **Inactive**: No recent deployments
- **Failed**: Last deployment failed
- **Pending**: Deployment waiting for approval

### Environment Approval Workflow

For staging and production environments:

1. **Trigger Deployment**
   - Run the Deploy Pipeline workflow
   - Select target environment
   - Configure deployment options

2. **Approval Process**
   - Designated reviewers receive notification
   - Reviewers can view deployment details
   - Approve or reject deployment
   - Comments can be added for context

3. **Deployment Execution**
   - After approval, deployment proceeds
   - Real-time logs available in Actions tab
   - Environment URL updated on success
   - Notifications sent to relevant channels

### Environment Rollback

If issues are detected after deployment:

1. **Immediate Rollback**
   - Trigger new deployment with previous version
   - Use force deployment if needed
   - Monitor rollback progress

2. **Environment Reset**
   - Use `serverless remove` to clean up resources
   - Redeploy from known good state
   - Verify environment health

## Package Scripts

The following npm scripts support the CI/CD pipeline:

### Testing Scripts
- `test:unit` - Run unit tests with coverage
- `test:integration` - Run integration tests
- `test:e2e` - Run end-to-end tests
- `test:smoke` - Run smoke tests
- `test:health` - Run health checks
- `test:coverage` - Generate coverage reports

### Build and Validation Scripts
- `build` - Compile TypeScript
- `build:clean` - Clean build with fresh compilation
- `validate` - Run complete validation suite
- `package` - Package for deployment
- `lint` - Run ESLint
- `format:check` - Check code formatting

### Deployment Scripts
- `deploy:dev` - Deploy to development
- `deploy:staging` - Deploy to staging
- `deploy:prod` - Deploy to production
- `info:dev/staging/prod` - Get deployment information

### Security Scripts
- `security:audit` - Run dependency audit
- `security:fix` - Fix security vulnerabilities

## Monitoring and Observability

### Build Status
- All workflows provide detailed status information
- Failed builds include comprehensive error logs
- Artifacts are preserved for debugging

### Deployment Tracking
- Each deployment creates detailed logs
- API endpoints are captured and validated
- Deployment tags track production releases

### Security Monitoring
- Daily security scans identify vulnerabilities
- Automated issue creation for security concerns
- License compliance tracking

## Troubleshooting

### Common Issues

#### 1. Build Failures
**Symptom**: TypeScript compilation errors
**Solution**: 
- Check for type errors in the code
- Ensure all dependencies are properly typed
- Verify tsconfig.json configuration

#### 2. Test Failures
**Symptom**: Unit or integration tests fail
**Solution**:
- Review test logs for specific failures
- Ensure test environment is properly configured
- Check for race conditions in async tests

#### 3. Deployment Failures
**Symptom**: Serverless deployment fails
**Solution**:
- Verify AWS credentials are correct
- Check IAM permissions for deployment
- Validate serverless.yml configuration
- Ensure resource limits are not exceeded

#### 4. Security Scan Failures
**Symptom**: High/critical vulnerabilities detected
**Solution**:
- Run `pnpm audit --fix` to auto-fix issues
- Manually update vulnerable dependencies
- Consider alternative packages if fixes unavailable

### Debug Commands

```bash
# Local validation
pnpm run validate

# Test specific environment deployment
pnpm run package:dev
pnpm run deploy:dev

# Check deployment status
pnpm run info:dev

# Run security audit
pnpm run security:audit

# Clean and rebuild
pnpm run clean
pnpm install
pnpm run build
```

### Getting Help

1. **Check workflow logs** in GitHub Actions tab
2. **Review error messages** in failed job outputs
3. **Validate configuration** using local commands
4. **Check AWS CloudFormation** for infrastructure issues
5. **Monitor CloudWatch logs** for runtime errors

## Best Practices

### Code Quality
- Always run `pnpm run validate` before pushing
- Use meaningful commit messages
- Keep pull requests focused and small
- Add tests for new functionality

### Security
- Regularly update dependencies
- Monitor security scan results
- Use least-privilege AWS IAM policies
- Rotate AWS credentials periodically

### Deployment
- Test changes in development first
- Use feature flags for risky changes
- Monitor deployments closely
- Have rollback procedures ready

### Maintenance
- Review dependency update notifications
- Address security vulnerabilities promptly
- Monitor infrastructure drift
- Keep documentation updated

## GitHub Secrets Setup Guide

### Setting Up Repository Secrets

1. **Navigate to Repository Settings**
   - Go to your GitHub repository
   - Click on "Settings" tab
   - Select "Secrets and variables" → "Actions"

2. **Add Environment-Specific Secrets**

   For each environment (dev, staging, prod), create the following secrets:

   #### Development Secrets
   ```
   Name: AWS_ACCESS_KEY_ID_DEV
   Value: [Your AWS Access Key ID for development]

   Name: AWS_SECRET_ACCESS_KEY_DEV
   Value: [Your AWS Secret Access Key for development]

   Name: AWS_REGION_DEV
   Value: us-east-1 (or your preferred region)
   ```

   #### Staging Secrets
   ```
   Name: AWS_ACCESS_KEY_ID_STAGING
   Value: [Your AWS Access Key ID for staging]

   Name: AWS_SECRET_ACCESS_KEY_STAGING
   Value: [Your AWS Secret Access Key for staging]

   Name: AWS_REGION_STAGING
   Value: us-east-1 (or your preferred region)
   ```

   #### Production Secrets
   ```
   Name: AWS_ACCESS_KEY_ID_PROD
   Value: [Your AWS Access Key ID for production]

   Name: AWS_SECRET_ACCESS_KEY_PROD
   Value: [Your AWS Secret Access Key for production]

   Name: AWS_REGION_PROD
   Value: us-east-1 (or your preferred region)
   ```

3. **Add Optional Service Secrets**

   #### Security and Monitoring
   ```
   Name: SNYK_TOKEN
   Value: [Your Snyk API token for security scanning]

   Name: CODECOV_TOKEN
   Value: [Your Codecov token for coverage reporting]

   Name: SLACK_WEBHOOK_URL
   Value: [Slack webhook URL for notifications]

   Name: PAGERDUTY_INTEGRATION_KEY
   Value: [PagerDuty integration key for alerts]
   ```

### AWS IAM Setup

Create separate IAM users for each environment with minimal required permissions:

#### Required IAM Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "apigateway:*",
        "sqs:*",
        "dynamodb:*",
        "logs:*",
        "iam:GetRole",
        "iam:PassRole",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": "*"
    }
  ]
}
```

### Environment Protection Rules

Configure GitHub environment protection rules:

1. **Go to Settings → Environments**
2. **Create environments**: development, staging, production
3. **Configure protection rules** as specified in environment configuration files

### Verification

After setup, verify the configuration:

1. **Trigger a test deployment**
2. **Check workflow logs** for successful authentication
3. **Validate deployed resources** in AWS console
4. **Test API endpoints** for functionality

This completes the CI/CD setup. The pipeline will now automatically handle testing, security scanning, and deployment across all environments.
