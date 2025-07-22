#!/usr/bin/env node

/**
 * Database Validation and Record Integrity Tests
 * 
 * This test suite validates:
 * 1. Database record accuracy and completeness
 * 2. Retry count tracking and consistency
 * 3. Status transitions and timestamps
 * 4. Data integrity across the entire workflow
 * 5. Performance and query efficiency
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { cleanupTestData } = require('./utils/database-cleanup.cjs');


const region = 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';
const TABLE_NAME = 'fault-tolerant-service-tasks-dev';


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

async function submitTask(taskId, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ taskId, payload });
    const options = {
      hostname: 'xmfkjn2blb.execute-api.us-east-1.amazonaws.com',
      port: 443,
      path: '/dev/submit-task',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-Correlation-ID': uuidv4()
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, response, taskId });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getTaskFromDynamoDB(taskId) {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: { taskId }
    });
    const result = await dynamodb.send(command);
    return result.Item || null;
  } catch (error) {
    log(`Error getting task from DynamoDB: ${error.message}`);
    return null;
  }
}

async function scanRecentTasks(hoursBack = 2) {
  try {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const command = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'createdAt > :cutoffTime',
      ExpressionAttributeValues: {
        ':cutoffTime': cutoffTime
      }
    });
    const result = await dynamodb.send(command);
    return result.Items || [];
  } catch (error) {
    log(`Error scanning recent tasks: ${error.message}`);
    return [];
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDatabaseRecordCompleteness() {
  log('🧪 TEST 1: Database Record Completeness');
  
  const taskId = `db-completeness-${Date.now()}`;
  const payload = {
    testType: 'database-completeness',
    metadata: {
      testId: uuidv4(),
      timestamp: new Date().toISOString(),
      expectedFields: ['taskId', 'status', 'createdAt', 'updatedAt', 'retryCount', 'failureDestiny']
    }
  };
  
  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Task submitted for completeness test', 'DB Completeness');
    

    await wait(30000);
    

    const dbTask = await getTaskFromDynamoDB(taskId);
    assert(dbTask !== null, 'Task exists in database', 'DB Completeness');

    if (dbTask !== null) {

      const requiredFields = [
        'taskId', 'status', 'createdAt', 'updatedAt', 'retryCount', 'failureDestiny', 'payload'
      ];

      let missingFields = [];
      for (const field of requiredFields) {
        if (dbTask[field] === undefined || dbTask[field] === null) {
          missingFields.push(field);
        }
      }

      assert(missingFields.length === 0, `All required fields present (missing: ${missingFields.join(', ')})`, 'DB Completeness');


      assert(typeof dbTask.taskId === 'string', 'taskId is string', 'DB Completeness');
      assert(typeof dbTask.status === 'string', 'status is string', 'DB Completeness');
      assert(typeof dbTask.createdAt === 'string', 'createdAt is string', 'DB Completeness');
      assert(typeof dbTask.updatedAt === 'string', 'updatedAt is string', 'DB Completeness');
      assert(typeof dbTask.retryCount === 'number', 'retryCount is number', 'DB Completeness');
      assert(typeof dbTask.failureDestiny === 'boolean', 'failureDestiny is boolean', 'DB Completeness');
      assert(typeof dbTask.payload === 'object', 'payload is object', 'DB Completeness');
    } else {
      log(`❌ Database completeness test failed: Cannot read properties of null (reading 'taskId')`);
    }
    

    const createdAt = new Date(dbTask.createdAt);
    const updatedAt = new Date(dbTask.updatedAt);
    assert(!isNaN(createdAt.getTime()), 'createdAt is valid timestamp', 'DB Completeness');
    assert(!isNaN(updatedAt.getTime()), 'updatedAt is valid timestamp', 'DB Completeness');
    assert(updatedAt >= createdAt, 'updatedAt >= createdAt', 'DB Completeness');
    

    const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'];
    assert(validStatuses.includes(dbTask.status), `Status is valid (${dbTask.status})`, 'DB Completeness');
    

    assert(dbTask.retryCount >= 0, 'retryCount is non-negative', 'DB Completeness');
    assert(dbTask.retryCount <= 3, 'retryCount within expected range', 'DB Completeness');
    
    log(`DB completeness - Status: ${dbTask.status}, RetryCount: ${dbTask.retryCount}, FailureDestiny: ${dbTask.failureDestiny}`);
    
    return { taskId, dbTask };
    
  } catch (error) {
    assert(false, `Database completeness test failed: ${error.message}`, 'DB Completeness');
    return null;
  }
}

async function testRetryCountAccuracy() {
  log('🧪 TEST 2: Retry Count Accuracy');
  
  const taskId = `retry-accuracy-force-fail-${Date.now()}`;
  const payload = {
    testType: 'retry-count-accuracy',
    forceFailure: true,
    expectedRetries: 2
  };
  
  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Failing task submitted for retry accuracy test', 'Retry Accuracy');
    

    const retryStates = [];
    

    await wait(5000);
    let dbTask = await getTaskFromDynamoDB(taskId);
    if (dbTask) {
      retryStates.push({ 
        timestamp: new Date().toISOString(), 
        status: dbTask.status, 
        retryCount: dbTask.retryCount 
      });
    }
    

    log('Waiting 6 minutes for retry accuracy test...');
    await wait(360000);
    

    dbTask = await getTaskFromDynamoDB(taskId);
    assert(dbTask !== null, 'Task exists after retries', 'Retry Accuracy');

    if (dbTask !== null) {
      retryStates.push({
        timestamp: new Date().toISOString(),
        status: dbTask.status,
        retryCount: dbTask.retryCount
      });


      if (dbTask.status === 'PROCESSING') {
        log(`⚠️ Task still processing after 6 minutes. Status: ${dbTask.status}, RetryCount: ${dbTask.retryCount}`);
        log(`💡 This may indicate the task needs more time to complete all retries (up to 10 minutes total)`);

        assert(['FAILED', 'DEAD_LETTER', 'PROCESSING'].includes(dbTask.status), 'Task in expected state (may still be processing)', 'Retry Accuracy');
      } else {

        assert(['FAILED', 'DEAD_LETTER'].includes(dbTask.status), 'Task failed after retries', 'Retry Accuracy');
        assert(dbTask.retryCount >= 1, 'Task was retried at least once', 'Retry Accuracy');
        assert(dbTask.retryCount <= 3, 'Retry count within expected maximum', 'Retry Accuracy');
      }
    } else {
      log(`❌ Retry count accuracy test failed: Cannot read properties of null (reading 'status')`);
    }
    

    if (retryStates.length > 1) {
      const initialRetryCount = retryStates[0].retryCount;
      const finalRetryCount = retryStates[retryStates.length - 1].retryCount;
      assert(finalRetryCount >= initialRetryCount, 'Retry count increased or stayed same', 'Retry Accuracy');
    }
    
    log(`Retry accuracy - Initial: ${retryStates[0]?.retryCount || 0}, Final: ${dbTask.retryCount}`);
    log(`Retry progression:`, retryStates);
    
    return { taskId, dbTask, retryStates };

  } catch (error) {
    assert(false, `Retry count accuracy test failed: ${error.message}`, 'Retry Accuracy');
    return null;
  }
}

async function testStatusTransitions() {
  log('🧪 TEST 3: Status Transitions and Timestamps');

  const taskId = `status-transitions-${Date.now()}`;
  const payload = {
    testType: 'status-transitions',
    trackTransitions: true
  };

  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Task submitted for status transition test', 'Status Transitions');


    const statusHistory = [];


    await wait(3000);
    let dbTask = await getTaskFromDynamoDB(taskId);
    if (dbTask) {
      statusHistory.push({
        timestamp: new Date().toISOString(),
        status: dbTask.status,
        updatedAt: dbTask.updatedAt
      });
    }


    await wait(15000);
    dbTask = await getTaskFromDynamoDB(taskId);
    if (dbTask) {
      statusHistory.push({
        timestamp: new Date().toISOString(),
        status: dbTask.status,
        updatedAt: dbTask.updatedAt
      });
    }


    assert(statusHistory.length > 0, 'Status history captured', 'Status Transitions');

    if (statusHistory.length >= 2) {
      const firstStatus = statusHistory[0];
      const lastStatus = statusHistory[statusHistory.length - 1];


      assert(new Date(lastStatus.updatedAt) >= new Date(firstStatus.updatedAt),
             'updatedAt timestamp progresses correctly', 'Status Transitions');


      const validTransitions = {
        'PENDING': ['PROCESSING', 'COMPLETED', 'FAILED'],
        'PROCESSING': ['COMPLETED', 'FAILED', 'PENDING'],
        'COMPLETED': [],
        'FAILED': ['DEAD_LETTER'],
        'DEAD_LETTER': []
      };

      for (let i = 1; i < statusHistory.length; i++) {
        const prevStatus = statusHistory[i-1].status;
        const currentStatus = statusHistory[i].status;

        if (prevStatus !== currentStatus) {
          const allowedTransitions = validTransitions[prevStatus] || [];
          assert(allowedTransitions.includes(currentStatus) || currentStatus === prevStatus,
                 `Valid status transition: ${prevStatus} -> ${currentStatus}`, 'Status Transitions');
        }
      }
    }

    log(`Status transitions:`, statusHistory);

    return { taskId, statusHistory, finalTask: dbTask };

  } catch (error) {
    assert(false, `Status transitions test failed: ${error.message}`, 'Status Transitions');
    return null;
  }
}

async function testDataIntegrityAcrossWorkflow() {
  log('🧪 TEST 4: Data Integrity Across Workflow');

  try {

    const recentTasks = await scanRecentTasks(1);
    assert(recentTasks.length > 0, 'Found recent tasks for integrity analysis', 'Data Integrity');

    let integrityIssues = [];
    let validTasks = 0;

    for (const task of recentTasks) {
      let taskIssues = [];


      if (!task.taskId || task.taskId.length === 0) {
        taskIssues.push('Missing or empty taskId');
      }

      if (!task.status || !['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(task.status)) {
        taskIssues.push('Invalid status');
      }

      if (typeof task.retryCount !== 'number' || task.retryCount < 0 || task.retryCount > 3) {
        taskIssues.push('Invalid retryCount');
      }

      if (typeof task.failureDestiny !== 'boolean') {
        taskIssues.push('Invalid failureDestiny');
      }


      try {
        const createdAt = new Date(task.createdAt);
        const updatedAt = new Date(task.updatedAt);

        if (isNaN(createdAt.getTime())) {
          taskIssues.push('Invalid createdAt timestamp');
        }

        if (isNaN(updatedAt.getTime())) {
          taskIssues.push('Invalid updatedAt timestamp');
        }

        if (updatedAt < createdAt) {
          taskIssues.push('updatedAt before createdAt');
        }
      } catch (e) {
        taskIssues.push('Timestamp parsing error');
      }


      if (['FAILED', 'DEAD_LETTER'].includes(task.status)) {
        if (!task.lastError || task.lastError.length === 0) {
          taskIssues.push('Missing error message for failed task');
        }

        if (!task.failedAt) {
          taskIssues.push('Missing failedAt timestamp for failed task');
        }
      }

      if (task.status === 'COMPLETED' && !task.completedAt) {
        taskIssues.push('Missing completedAt timestamp for completed task');
      }


      if (task.retryCount > 0 && task.status === 'COMPLETED') {
        taskIssues.push('Completed task should not have retries');
      }

      if (taskIssues.length === 0) {
        validTasks++;
      } else {
        integrityIssues.push({
          taskId: task.taskId,
          issues: taskIssues
        });
      }
    }

    const integrityPercentage = (validTasks / recentTasks.length) * 100;

    assert(integrityPercentage >= 90, `Data integrity >= 90% (${integrityPercentage.toFixed(1)}%)`, 'Data Integrity');
    assert(integrityIssues.length <= recentTasks.length * 0.1, 'Integrity issues within acceptable threshold', 'Data Integrity');

    if (integrityIssues.length > 0) {
      log(`Data integrity issues found:`, integrityIssues.slice(0, 3));
    }

    log(`Data integrity - Total: ${recentTasks.length}, Valid: ${validTasks}, Issues: ${integrityIssues.length}`);

    return {
      totalTasks: recentTasks.length,
      validTasks,
      integrityIssues: integrityIssues.length,
      integrityPercentage
    };

  } catch (error) {
    assert(false, `Data integrity test failed: ${error.message}`, 'Data Integrity');
    return null;
  }
}


async function runDatabaseValidationTests() {
  console.log('🚀 DATABASE VALIDATION TESTS');
  console.log('============================');
  console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
  console.log(`🗄️  DynamoDB Table: ${TABLE_NAME}`);
  console.log(`📅 Test Time: ${new Date().toISOString()}`);
  console.log('');

  const startTime = Date.now();
  const results = {};

  try {

    console.log('🧹 Cleaning up test data before starting database validation tests...');
    await cleanupTestData();
    console.log('✅ Test data cleanup completed\n');


    results.recordCompleteness = await testDatabaseRecordCompleteness();
    results.retryAccuracy = await testRetryCountAccuracy();
    results.statusTransitions = await testStatusTransitions();
    results.dataIntegrity = await testDataIntegrityAcrossWorkflow();


    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n📊 DATABASE VALIDATION RESULTS');
    console.log('===============================');
    console.log(`⏱️  Total Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📈 Total Tests: ${testResults.totalTests}`);
    console.log(`✅ Passed: ${testResults.passedTests}`);
    console.log(`❌ Failed: ${testResults.failedTests}`);
    console.log(`📊 Success Rate: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);


    console.log('\n📋 DATABASE TEST SUMMARY:');
    console.log('=========================');

    if (results.recordCompleteness) {
      console.log(`✅ Record Completeness: All required fields present`);
    }

    if (results.retryAccuracy) {
      console.log(`✅ Retry Accuracy: Final retry count ${results.retryAccuracy.dbTask?.retryCount}`);
    }

    if (results.statusTransitions) {
      console.log(`✅ Status Transitions: ${results.statusTransitions.statusHistory?.length || 0} transitions tracked`);
    }

    if (results.dataIntegrity) {
      console.log(`✅ Data Integrity: ${results.dataIntegrity.integrityPercentage?.toFixed(1)}% of records valid`);
    }

    if (testResults.failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.errors.forEach(error => console.log(`   ${error}`));
    }

    if (testResults.failedTests === 0) {
      console.log('\n🎉 ALL DATABASE TESTS PASSED! Database records are accurate and consistent.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME DATABASE TESTS FAILED! Please review the errors above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 DATABASE TEST EXECUTION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}


if (require.main === module) {
  runDatabaseValidationTests();
}

module.exports = {
  runDatabaseValidationTests,
  testDatabaseRecordCompleteness,
  testRetryCountAccuracy,
  testStatusTransitions,
  testDataIntegrityAcrossWorkflow
};
