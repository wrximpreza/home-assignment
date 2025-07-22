#!/usr/bin/env node

/**
 * System Test Runner
 *
 * Comprehensive test runner that executes multiple test scenarios
 * against the deployed fault-tolerant service infrastructure.
 */

const { spawn } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  count: 10,
  timeout: 60000,
  verbose: false,
  help: false
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--count=')) {
    options.count = parseInt(arg.split('=')[1]) || 10;
  } else if (arg.startsWith('--timeout=')) {
    options.timeout = parseInt(arg.split('=')[1]) || 60000;
  } else if (arg === '--verbose') {
    options.verbose = true;
  } else if (arg === '--help' || arg === '-h') {
    options.help = true;
  }
}

// Help text
if (options.help) {
  console.log(`
🚀 SYSTEM TEST RUNNER
====================

Usage: node scripts/test-system.cjs [options]

Options:
  --count=N       Number of test iterations (default: 10)
  --timeout=N     Timeout in milliseconds (default: 60000)
  --verbose       Enable verbose output
  --help, -h      Show this help message

Examples:
  npm run test                    # Run default tests (10 iterations)
  npm run test:load              # Load test (50 iterations)
  npm run test:quick             # Quick test (5 iterations, 30s timeout)
  npm run test:verbose           # Verbose output

Test Suites:
  - Unit Tests (Jest)
  - Integration Tests (Jest)
  - E2E Tests (AWS Infrastructure)
  - Load Testing (Multiple iterations)
`);
  process.exit(0);
}

console.log(`
🚀 SYSTEM TEST RUNNER
====================
📊 Test Count: ${options.count}
⏱️  Timeout: ${options.timeout}ms
🔍 Verbose: ${options.verbose}
📅 Start Time: ${new Date().toISOString()}
`);

/**
 * Execute a command and return a promise
 */
function executeCommand(command, args = [], cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    if (options.verbose) {
      console.log(`\n🔧 Executing: ${command} ${args.join(' ')}`);
    }

    const child = spawn(command, args, {
      cwd,
      stdio: options.verbose ? 'inherit' : 'pipe',
      shell: true
    });

    let stdout = '';
    let stderr = '';

    if (!options.verbose) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Run test suite
 */
async function runTestSuite() {
  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  try {
    console.log('\n📋 RUNNING TEST SUITE');
    console.log('=====================');

    // 1. Unit Tests
    console.log('\n🧪 Running Unit Tests...');
    try {
      await executeCommand('npm', ['run', 'test:unit']);
      console.log('✅ Unit Tests: PASSED');
      passed++;
    } catch (error) {
      console.log('❌ Unit Tests: FAILED');
      if (options.verbose) console.error(error.message);
      failed++;
    }

    // 2. Integration Tests
    console.log('\n🔗 Running Integration Tests...');
    try {
      await executeCommand('npm', ['run', 'test:integration']);
      console.log('✅ Integration Tests: PASSED');
      passed++;
    } catch (error) {
      console.log('❌ Integration Tests: FAILED');
      if (options.verbose) console.error(error.message);
      failed++;
    }

    // 3. Build Test
    console.log('\n🏗️  Running Build Test...');
    try {
      await executeCommand('npm', ['run', 'build']);
      console.log('✅ Build Test: PASSED');
      passed++;
    } catch (error) {
      console.log('❌ Build Test: FAILED');
      if (options.verbose) console.error(error.message);
      failed++;
    }

    // 4. Lint Test
    console.log('\n🔍 Running Lint Test...');
    try {
      await executeCommand('npm', ['run', 'lint']);
      console.log('✅ Lint Test: PASSED');
      passed++;
    } catch (error) {
      console.log('❌ Lint Test: FAILED');
      if (options.verbose) console.error(error.message);
      failed++;
    }

    // 5. E2E Health Check (only for load tests with count > 10)
    if (options.count > 10) {
      console.log('\n🌐 Running E2E Health Check...');
      try {
        await executeCommand('npm', ['run', 'test:health']);
        console.log('✅ E2E Health Check: PASSED');
        passed++;
      } catch (error) {
        console.log('❌ E2E Health Check: FAILED');
        if (options.verbose) console.error(error.message);
        failed++;
      }
    }

    const duration = Date.now() - startTime;

    console.log('\n📊 TEST SUITE RESULTS');
    console.log('=====================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`📅 Completed: ${new Date().toISOString()}`);

    return { passed, failed, duration };

  } catch (error) {
    console.error('\n💥 Test suite execution failed:', error.message);
    throw error;
  }
}

/**
 * Run load test iterations
 */
async function runLoadTest() {
  console.log(`\n🚀 STARTING LOAD TEST (${options.count} iterations)`);
  console.log('='.repeat(50));

  const results = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (let i = 1; i <= options.count; i++) {
    console.log(`\n📋 Iteration ${i}/${options.count}`);
    console.log('-'.repeat(30));

    try {
      const result = await runTestSuite();
      results.push(result);
      totalPassed += result.passed;
      totalFailed += result.failed;

      console.log(`✅ Iteration ${i}: COMPLETED`);
    } catch (error) {
      console.log(`❌ Iteration ${i}: FAILED - ${error.message}`);
      results.push({ passed: 0, failed: 1, duration: 0, error: error.message });
      totalFailed++;
    }

    // Brief pause between iterations
    if (i < options.count) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Final summary
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / results.length;
  const successRate = (totalPassed / (totalPassed + totalFailed)) * 100;

  console.log('\n🎯 LOAD TEST SUMMARY');
  console.log('===================');
  console.log(`📊 Iterations: ${options.count}`);
  console.log(`✅ Total Passed: ${totalPassed}`);
  console.log(`❌ Total Failed: ${totalFailed}`);
  console.log(`📈 Success Rate: ${successRate.toFixed(2)}%`);
  console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`📊 Average Duration: ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`📅 Completed: ${new Date().toISOString()}`);

  // Exit with appropriate code
  process.exit(totalFailed > 0 ? 1 : 0);
}

/**
 * Main execution
 */
async function main() {
  try {
    if (options.count === 1) {
      await runTestSuite();
    } else {
      await runLoadTest();
    }
  } catch (error) {
    console.error('\n💥 System test failed:', error.message);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test execution interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Test execution terminated');
  process.exit(1);
});

// Run the main function
main().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
