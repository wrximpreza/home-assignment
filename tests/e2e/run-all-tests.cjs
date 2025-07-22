#!/usr/bin/env node

/**
 * E2E Test Runner
 * 
 * Executes all end-to-end tests in sequence and provides comprehensive reporting
 */

const { spawn } = require('child_process');
const path = require('path');
const { cleanupTestData } = require('./utils/database-cleanup.cjs');


const tests = [
  {
    name: 'Comprehensive AWS Flow Tests',
    file: 'comprehensive-aws-flow-test.cjs',
    description: 'Tests complete task processing workflow including retries and failure handling'
  },
  {
    name: 'DLQ and Error Handling Tests',
    file: 'dlq-error-handling-test.cjs',
    description: 'Tests Dead Letter Queue functionality and error propagation'
  },
  {
    name: 'Database Validation Tests',
    file: 'database-validation-test.cjs',
    description: 'Tests database record accuracy, retry counts, and data integrity'
  },
  {
    name: 'DTO Validation Tests',
    file: 'dto-validation-test.cjs',
    description: 'Tests request and response DTO validation'
  }
];


const testResults = {
  totalSuites: tests.length,
  passedSuites: 0,
  failedSuites: 0,
  suiteResults: [],
  startTime: Date.now()
};

function log(message, data = {}) {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length > 0 ? data : '');
}

function runTest(testConfig) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, testConfig.file);
    const startTime = Date.now();
    
    log(`🚀 Starting: ${testConfig.name}`);
    log(`📄 Description: ${testConfig.description}`);
    
    const child = spawn('node', [testPath], {
      stdio: 'pipe',
      cwd: __dirname
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      const result = {
        name: testConfig.name,
        file: testConfig.file,
        exitCode: code,
        duration,
        passed: code === 0,
        stdout,
        stderr
      };
      
      if (code === 0) {
        testResults.passedSuites++;
        log(`✅ PASSED: ${testConfig.name} (${duration.toFixed(1)}s)`);
      } else {
        testResults.failedSuites++;
        log(`❌ FAILED: ${testConfig.name} (${duration.toFixed(1)}s) - Exit code: ${code}`);
      }
      
      testResults.suiteResults.push(result);
      resolve(result);
    });
    
    child.on('error', (error) => {
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      const result = {
        name: testConfig.name,
        file: testConfig.file,
        exitCode: -1,
        duration,
        passed: false,
        stdout,
        stderr: error.message
      };
      
      testResults.failedSuites++;
      log(`❌ ERROR: ${testConfig.name} (${duration.toFixed(1)}s) - ${error.message}`);
      testResults.suiteResults.push(result);
      resolve(result);
    });
  });
}

async function runAllTests() {
  console.log('🚀 E2E TEST SUITE RUNNER');
  console.log('========================');
  console.log(`📅 Start Time: ${new Date().toISOString()}`);
  console.log(`📊 Total Test Suites: ${tests.length}`);
  console.log('');


  try {
    console.log('🧹 GLOBAL TEST DATA CLEANUP');
    console.log('===========================');
    await cleanupTestData();
    console.log('✅ Global cleanup completed\n');
  } catch (error) {
    console.error('❌ Global cleanup failed:', error.message);
    console.error('Tests may run with existing data\n');
  }


  for (const test of tests) {
    await runTest(test);
    console.log('');
  }
  

  const totalDuration = (Date.now() - testResults.startTime) / 1000;
  
  console.log('📊 FINAL E2E TEST RESULTS');
  console.log('=========================');
  console.log(`⏱️  Total Duration: ${totalDuration.toFixed(1)} seconds`);
  console.log(`📈 Total Test Suites: ${testResults.totalSuites}`);
  console.log(`✅ Passed Suites: ${testResults.passedSuites}`);
  console.log(`❌ Failed Suites: ${testResults.failedSuites}`);
  console.log(`📊 Success Rate: ${((testResults.passedSuites / testResults.totalSuites) * 100).toFixed(1)}%`);
  console.log('');
  

  console.log('📋 DETAILED SUITE RESULTS:');
  console.log('===========================');
  
  testResults.suiteResults.forEach((result, index) => {
    const icon = result.passed ? '✅' : '❌';
    const status = result.passed ? 'PASSED' : 'FAILED';
    console.log(`${index + 1}. ${icon} ${result.name}`);
    console.log(`   Status: ${status}`);
    console.log(`   Duration: ${result.duration.toFixed(1)}s`);
    console.log(`   Exit Code: ${result.exitCode}`);
    
    if (!result.passed && result.stderr) {
      console.log(`   Error: ${result.stderr.split('\n')[0]}`);
    }
    console.log('');
  });
  

  const failedTests = testResults.suiteResults.filter(r => !r.passed);
  if (failedTests.length > 0) {
    console.log('❌ FAILED TEST OUTPUTS:');
    console.log('=======================');
    
    failedTests.forEach((result) => {
      console.log(`\n--- ${result.name} ---`);
      if (result.stdout) {
        console.log('STDOUT:');
        console.log(result.stdout.split('\n').slice(-20).join('\n'));
      }
      if (result.stderr) {
        console.log('STDERR:');
        console.log(result.stderr);
      }
    });
  }
  

  console.log('\n🎯 SUMMARY AND RECOMMENDATIONS:');
  console.log('===============================');
  
  if (testResults.failedSuites === 0) {
    console.log('🎉 ALL E2E TESTS PASSED!');
    console.log('✅ The fault-tolerant task processing system is working correctly across all tested scenarios.');
    console.log('✅ AWS infrastructure, retry mechanisms, DLQ, and database operations are functioning properly.');
    console.log('✅ System is ready for production use.');
  } else {
    console.log(`⚠️  ${testResults.failedSuites} out of ${testResults.totalSuites} test suites failed.`);
    console.log('🔍 Please review the failed test outputs above for specific issues.');
    console.log('🛠️  Common issues to check:');
    console.log('   - AWS credentials and permissions');
    console.log('   - Network connectivity to AWS services');
    console.log('   - Lambda function deployment status');
    console.log('   - SQS queue configuration');
    console.log('   - DynamoDB table accessibility');
  }
  

  process.exit(testResults.failedSuites === 0 ? 0 : 1);
}


process.on('SIGINT', () => {
  console.log('\n⚠️  Test execution interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Test execution terminated');
  process.exit(1);
});


runAllTests().catch((error) => {
  console.error('\n💥 TEST RUNNER FAILED:', error.message);
  console.error(error.stack);
  process.exit(1);
});
