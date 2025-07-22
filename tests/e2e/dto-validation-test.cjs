#!/usr/bin/env node

/**
 * DTO Validation Tests
 * 
 * This test suite validates request and response DTO validation
 */

const https = require('https');
const { cleanupTestData } = require('./utils/database-cleanup.cjs');


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';


let testResults = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  errors: []
};

function log(message, data = {}) {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length > 0 ? data : '');
}

function assert(condition, message, testName) {
  testResults.totalTests++;
  if (condition) {
    testResults.passedTests++;
    log(`✅ PASS: ${testName} - ${message}`);
  } else {
    testResults.failedTests++;
    log(`❌ FAIL: ${testName} - ${message}`);
    testResults.errors.push(`${testName}: ${message}`);
  }
}

async function makeRequest(path, method, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'xmfkjn2blb.execute-api.us-east-1.amazonaws.com',
      port: 443,
      path: `/dev${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': `test-${Date.now()}`,
      }
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const response = responseData ? JSON.parse(responseData) : {};
          resolve({ statusCode: res.statusCode, response, headers: res.headers });
        } catch (error) {
          resolve({ statusCode: res.statusCode, response: responseData, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

async function testValidRequestValidation() {
  log('🧪 TEST 1: Valid Request Validation');

  const validRequest = {
    taskId: `valid-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    payload: {
      testType: 'validation-test',
      data: 'test data'
    }
  };
  
  try {
    const result = await makeRequest('/submit-task', 'POST', validRequest);
    
    assert(result.statusCode === 201, 'Valid request returns 201', 'Valid Request');
    assert(typeof result.response === 'object', 'Response is JSON object', 'Valid Request');
    assert(result.response.success === true, 'Response indicates success', 'Valid Request');
    assert(typeof result.response.data === 'object', 'Response has data object', 'Valid Request');
    assert(result.response.data.taskId === validRequest.taskId, 'Response contains correct taskId', 'Valid Request');
    assert(result.response.data.status === 'queued', 'Response has correct status', 'Valid Request');
    assert(typeof result.response.timestamp === 'string', 'Response has timestamp', 'Valid Request');
    
    return { success: true, result };
    
  } catch (error) {
    assert(false, `Valid request test failed: ${error.message}`, 'Valid Request');
    return { success: false, error };
  }
}

async function testInvalidRequestValidation() {
  log('🧪 TEST 2: Invalid Request Validation');
  
  const invalidRequests = [
    {
      name: 'Missing taskId',
      data: { payload: { test: 'data' } },
      expectedError: 'taskId'
    },
    {
      name: 'Empty taskId',
      data: { taskId: '', payload: { test: 'data' } },
      expectedError: 'Task ID is required'
    },
    {
      name: 'Invalid taskId characters',
      data: { taskId: 'invalid@task!', payload: { test: 'data' } },
      expectedError: 'alphanumeric'
    },
    {
      name: 'Missing payload',
      data: { taskId: 'valid-task' },
      expectedError: 'payload'
    },
    {
      name: 'Too long taskId',
      data: { taskId: 'a'.repeat(300), payload: { test: 'data' } },
      expectedError: 'less than 255'
    }
  ];
  
  let validationTests = 0;
  
  for (const testCase of invalidRequests) {
    try {
      const result = await makeRequest('/submit-task', 'POST', testCase.data);
      
      assert(result.statusCode === 400, `${testCase.name} returns 400 status`, 'Invalid Request');
      
      if (typeof result.response === 'object' && result.response.error) {
        const errorMessage = result.response.error.toLowerCase();
        const expectedError = testCase.expectedError.toLowerCase();
        assert(errorMessage.includes(expectedError), `${testCase.name} contains expected error`, 'Invalid Request');
      } else if (typeof result.response === 'string') {
        const errorMessage = result.response.toLowerCase();
        const expectedError = testCase.expectedError.toLowerCase();
        assert(errorMessage.includes(expectedError), `${testCase.name} contains expected error`, 'Invalid Request');
      }
      
      validationTests++;
      
    } catch (error) {
      assert(false, `${testCase.name} test failed: ${error.message}`, 'Invalid Request');
    }
  }
  
  return { validationTests };
}

async function testInvalidJsonValidation() {
  log('🧪 TEST 3: Invalid JSON Validation');
  
  try {

    const result = await new Promise((resolve, reject) => {
      const invalidJson = '{ "taskId": "test", "payload": { invalid json }';
      const options = {
        hostname: 'xmfkjn2blb.execute-api.us-east-1.amazonaws.com',
        port: 443,
        path: '/dev/submit-task',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(invalidJson),
          'X-Correlation-ID': `test-${Date.now()}`,
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          try {
            const response = responseData ? JSON.parse(responseData) : {};
            resolve({ statusCode: res.statusCode, response });
          } catch (error) {
            resolve({ statusCode: res.statusCode, response: responseData });
          }
        });
      });

      req.on('error', reject);
      req.write(invalidJson);
      req.end();
    });
    
    assert(result.statusCode === 415 || result.statusCode === 400, 'Invalid JSON returns 415 or 400 status', 'Invalid JSON');
    
    const errorMessage = typeof result.response === 'string' ? result.response : 
                        (result.response.error || JSON.stringify(result.response));
    assert(errorMessage.toLowerCase().includes('json') || errorMessage.toLowerCase().includes('parse'), 
           'Error message mentions JSON parsing', 'Invalid JSON');
    
    return { success: true };
    
  } catch (error) {
    assert(false, `Invalid JSON test failed: ${error.message}`, 'Invalid JSON');
    return { success: false, error };
  }
}

async function testResponseValidation() {
  log('🧪 TEST 4: Response Validation');

  const validRequest = {
    taskId: `response-validation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    payload: { testType: 'response-validation' }
  };
  
  try {
    const result = await makeRequest('/submit-task', 'POST', validRequest);
    

    assert(typeof result.response.success === 'boolean', 'Response has success field', 'Response Validation');
    assert(typeof result.response.data === 'object', 'Response has data object', 'Response Validation');
    assert(typeof result.response.data.taskId === 'string', 'Data has taskId string', 'Response Validation');
    assert(typeof result.response.data.status === 'string', 'Data has status string', 'Response Validation');
    assert(typeof result.response.data.message === 'string', 'Data has message string', 'Response Validation');
    assert(typeof result.response.timestamp === 'string', 'Response has timestamp string', 'Response Validation');
    

    const timestamp = new Date(result.response.timestamp);
    assert(!isNaN(timestamp.getTime()), 'Timestamp is valid ISO string', 'Response Validation');
    
    return { success: true, result };
    
  } catch (error) {
    assert(false, `Response validation test failed: ${error.message}`, 'Response Validation');
    return { success: false, error };
  }
}

async function runDTOValidationTests() {
  console.log('🚀 DTO VALIDATION TESTS');
  console.log('=======================');
  console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
  console.log(`📅 Test Time: ${new Date().toISOString()}`);
  console.log('');

  const startTime = Date.now();
  const results = {};

  try {

    console.log('🧹 Cleaning up test data before starting DTO validation tests...');
    await cleanupTestData();
    console.log('✅ Test data cleanup completed\n');


    results.validRequest = await testValidRequestValidation();
    results.invalidRequest = await testInvalidRequestValidation();
    results.invalidJson = await testInvalidJsonValidation();
    results.responseValidation = await testResponseValidation();


    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n📊 DTO VALIDATION TEST RESULTS');
    console.log('===============================');
    console.log(`⏱️  Total Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📈 Total Tests: ${testResults.totalTests}`);
    console.log(`✅ Passed: ${testResults.passedTests}`);
    console.log(`❌ Failed: ${testResults.failedTests}`);
    console.log(`📊 Success Rate: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);

    if (testResults.failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.errors.forEach(error => console.log(`   ${error}`));
    }

    if (testResults.failedTests === 0) {
      console.log('\n🎉 ALL DTO VALIDATION TESTS PASSED! Request and response validation is working correctly.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME DTO VALIDATION TESTS FAILED! Please review the errors above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 DTO VALIDATION TEST EXECUTION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}


if (require.main === module) {
  runDTOValidationTests();
}

module.exports = {
  runDTOValidationTests,
  testValidRequestValidation,
  testInvalidRequestValidation,
  testInvalidJsonValidation,
  testResponseValidation
};
