# Development Guide

## 🛠️ Development Environment Setup

### Prerequisites
- Node.js 18+ 
- npm or pnpm
- AWS CLI configured
- VS Code (recommended)

### Initial Setup
```bash
# Clone the repository
git clone <repository-url>
cd fault-tolerant-service

# Install dependencies
npm install

# Verify setup
npm run validate
```

## 🎯 VS Code Configuration

The project includes comprehensive VS Code configuration for optimal development experience:

### Extensions
The project automatically recommends essential extensions:
- ESLint for code linting
- Prettier for code formatting
- AWS Toolkit for AWS integration
- TypeScript support
- Jest testing support

### Settings
Pre-configured settings include:
- Format on save enabled
- ESLint auto-fix on save
- Consistent tab size (2 spaces)
- Import organization
- TypeScript strict mode

### Debugging
Launch configurations available:
- Debug Jest tests
- Debug current test file
- Debug TypeScript files
- Debug Serverless offline
- Debug Lambda functions

### Tasks
Pre-configured tasks:
- Build TypeScript
- Format code
- Lint code
- Run tests
- Start serverless offline

## 📝 Code Quality Standards

### Formatting and Linting
```bash
# Check code quality (lint + format check)
npm run code:check

# Fix all issues automatically
npm run code:fix

# Individual commands
npm run lint:check      # Check linting only
npm run lint:fix        # Fix linting issues
npm run format         # Format code
npm run format:check   # Check formatting
```

### Code Style Guidelines
- **Airbnb TypeScript Style Guide** - Enforced via ESLint
- **Prettier** - Consistent code formatting
- **Import Organization** - Automatic import sorting
- **Type Safety** - Strict TypeScript configuration

### Code Organization
- **Logical Spacing** - Blank lines between logical sections
- **Function Separation** - Clear boundaries between operations
- **Error Handling** - Proper spacing around try-catch blocks
- **No Comments** - Self-documenting code preferred

## 🧪 Testing Strategy

### Test Types
```bash
# Unit tests
npm run test:unit

# Integration tests  
npm run test:integration

# E2E tests (requires deployed infrastructure)
npm run test:e2e

# All tests
npm run test
```

### Test Structure
- **Unit Tests** - `tests/unit/` - Individual function testing
- **Integration Tests** - `tests/integration/` - Service integration
- **E2E Tests** - `tests/e2e/` - Full system validation

## 🚀 Development Workflow

### 1. Code Development
```bash
# Start development server
npm run local

# Watch mode with auto-reload
npm run dev
```

### 2. Quality Assurance
```bash
# Validate entire project
npm run validate

# Fix any issues
npm run validate:fix
```

### 3. Testing
```bash
# Run relevant tests
npm run test:unit
npm run test:integration
```

### 4. Deployment
```bash
# Deploy to development
npm run deploy:dev

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:prod
```

## 🔧 Available Scripts

### Build & Development
- `npm run build` - Compile TypeScript
- `npm run build:clean` - Clean build
- `npm run local` - Start serverless offline
- `npm run dev` - Development with auto-reload

### Code Quality
- `npm run code:check` - Check linting and formatting
- `npm run code:fix` - Fix all code issues
- `npm run validate` - Full project validation
- `npm run validate:fix` - Validate and fix issues

### Testing
- `npm run test` - Run all tests
- `npm run test:unit` - Unit tests only
- `npm run test:integration` - Integration tests only
- `npm run test:e2e` - End-to-end tests

### Deployment
- `npm run deploy:dev` - Deploy to development
- `npm run deploy:staging` - Deploy to staging
- `npm run deploy:prod` - Deploy to production

### Utilities
- `npm run logs:dev` - View development logs
- `npm run invoke` - Invoke Lambda functions
- `npm run remove:dev` - Remove development stack

## 🎨 Code Formatting Standards

### Spacing Rules
- Blank lines between logical sections
- Spacing around error handling blocks
- Clear separation of operations
- Consistent indentation (2 spaces)

### Import Organization
- External libraries first
- Internal modules second
- Type imports separated
- Alphabetical ordering within groups

### TypeScript Standards
- Strict type checking enabled
- No `any` types (use proper typing)
- Interface over type aliases
- Consistent naming conventions

## 🐛 Debugging

### VS Code Debugging
1. Set breakpoints in TypeScript files
2. Use F5 to start debugging
3. Choose appropriate launch configuration
4. Debug in integrated terminal

### Lambda Function Debugging
```bash
# Invoke specific function locally
npm run invoke -- --function submitTask --data '{"test": "data"}'

# View function logs
npm run logs -- --function submitTask
```

### Common Issues
- **Build Errors** - Run `npm run build:clean`
- **Linting Issues** - Run `npm run code:fix`
- **Test Failures** - Check AWS credentials and environment
- **Deployment Issues** - Verify AWS CLI configuration

## 📊 Monitoring Development

### Local Development
- Serverless offline provides local API Gateway
- CloudWatch logs available via AWS CLI
- DynamoDB local for testing
- SQS local simulation

### Development Environment
- Separate AWS resources per stage
- Isolated testing environment
- Comprehensive logging enabled
- Metrics collection active

## 🔄 Git Workflow

### Commit Standards
- Meaningful commit messages
- Logical commit organization
- Code quality checks before commit
- Documentation updates included

### Branch Strategy
- `master` - Production ready code
- `develop` - Integration branch
- `feature/*` - Feature development
- `hotfix/*` - Production fixes
