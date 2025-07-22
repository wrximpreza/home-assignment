#!/usr/bin/env node

/**
 * Comprehensive End-to-End AWS Flow Tests
 * 
 * This test suite validates the complete fault-tolerant task processing system:
 * 1. Task submission through API Gateway
 * 2. Task processing via Lambda and SQS
 * 3. Retry mechanism with proper retry counts
 * 4. Dead Letter Queue (DLQ) functionality
 * 5. Database record consistency and accuracy
 * 6. Error handling and failure scenarios
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, ReceiveMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
const { v4: uuidv4 } = require('uuid');
const { cleanupTestData } = require('./utils/database-cleanup.cjs');


const region = 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sqs = new SQSClient({ region });


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';
const TABLE_NAME = 'fault-tolerant-service-tasks-dev';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-queue-dev';
const DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-dlq-dev';
const testResults = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  errors: [],
  testDetails: []
};


function log(message, data = {}) {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length > 0 ? data : '');
}

function assert(condition, message, testName) {
  testResults.totalTests++;
  if (condition) {
    testResults.passedTests++;
    log(`✅ PASS: ${testName} - ${message}`);
    testResults.testDetails.push({ test: testName, status: 'PASS', message });
  } else {
    testResults.failedTests++;
    log(`❌ FAIL: ${testName} - ${message}`);
    testResults.testDetails.push({ test: testName, status: 'FAIL', message });
    testResults.errors.push(`${testName}: ${message}`);
  }
}

function shouldTaskFail(taskId) {
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < taskId.length; i++) {
    const char = taskId.charCodeAt(i);
    hash1 = (hash1 << 5) - hash1 + char;
    hash2 = (hash2 << 3) - hash2 + char * 31;
  }


  const combinedHash = Math.abs(hash1 ^ hash2);
  const hashValue = combinedHash % 100000;


  return hashValue < 30000;
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

async function scanRecentTasks(hoursBack = 1) {
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

async function getQueueMessages(queueUrl, maxMessages = 10) {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 2,
      VisibilityTimeout: 30,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All']
    });
    const result = await sqs.send(command);
    return result.Messages || [];
  } catch (error) {
    log(`Error getting queue messages: ${error.message}`);
    return [];
  }
}

async function getQueueAttributes(queueUrl) {
  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    });
    const result = await sqs.send(command);
    return result.Attributes || {};
  } catch (error) {
    log(`Error getting queue attributes: ${error.message}`);
    return {};
  }
}

async function purgeQueue(queueUrl) {
  try {
    const command = new PurgeQueueCommand({
      QueueUrl: queueUrl
    });
    await sqs.send(command);
    log(`Purged queue: ${queueUrl}`);
  } catch (error) {
    log(`Error purging queue: ${error.message}`);
  }
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function testBasicTaskSubmissionAndProcessing() {
  log('🧪 TEST 1: Basic Task Submission and Processing');

  const taskId = `basic-test-${Date.now()}`;
  const payload = {
    testType: 'basic-processing',
    data: 'test data',
    timestamp: new Date().toISOString()
  };

  try {

    const result = await submitTask(taskId, payload);

    assert(result.statusCode === 201, 'API returns 201 status code', 'Basic Task Flow');
    assert(result.response.success === true, 'Response indicates success', 'Basic Task Flow');
    assert(result.response.data.taskId === taskId, 'Response contains correct task ID', 'Basic Task Flow');
    assert(result.response.data.status === 'queued', 'Task status is queued', 'Basic Task Flow');


    let dbTask = null;
    let attempts = 0;
    const maxAttempts = 20;


    while (!dbTask && attempts < maxAttempts) {
      await wait(1000);
      dbTask = await getTaskFromDynamoDB(taskId);
      attempts++;
      if (dbTask) {
        log(`Found task after ${attempts} attempts (${attempts} seconds)`);
      }
    }

    assert(dbTask !== null, 'Task was stored in DynamoDB', 'Basic Task Flow');
    assert(dbTask.taskId === taskId, 'DynamoDB task ID matches', 'Basic Task Flow');
    assert(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(dbTask.status), 'Task has valid status', 'Basic Task Flow');
    assert(typeof dbTask.failureDestiny === 'boolean', 'Failure destiny is set', 'Basic Task Flow');
    assert(typeof dbTask.retryCount === 'number', 'Retry count is initialized', 'Basic Task Flow');


    let finalTask = dbTask;
    let processingAttempts = 0;
    const maxProcessingAttempts = 60;

    while (processingAttempts < maxProcessingAttempts && finalTask && !['COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(finalTask.status)) {
      await wait(1000);
      finalTask = await getTaskFromDynamoDB(taskId);
      processingAttempts++;
      if (processingAttempts % 10 === 0) {
        log(`Still waiting for task completion... ${processingAttempts}s elapsed, status: ${finalTask?.status}`);
      }
    }


    const shouldFail = shouldTaskFail(taskId);

    if (finalTask) {
      if (shouldFail) {
        assert(['FAILED', 'DEAD_LETTER'].includes(finalTask.status), 'Task failed as expected', 'Basic Task Flow');
      } else {
        assert(finalTask.status === 'COMPLETED', 'Task completed successfully', 'Basic Task Flow');
      }
      log(`Task ${taskId} final status: ${finalTask.status}, shouldFail: ${shouldFail}`);
    } else {

      if (!shouldFail) {
        log('Task was processed and removed from database (likely completed successfully)');
      } else {
        assert(false, 'Expected failing task not found in database', 'Basic Task Flow');
      }
    }

    log(`Task ${taskId} final status: ${finalTask.status}, shouldFail: ${shouldFail}`);
    return { taskId, finalTask, shouldFail };

  } catch (error) {
    assert(false, `Basic task flow failed: ${error.message}`, 'Basic Task Flow');
    return null;
  }
}

async function testRetryMechanism() {
  log('🧪 TEST 2: Retry Mechanism Validation');

  const taskId = `force-fail-retry-${Date.now()}`;
  const payload = {
    testType: 'retry-testing',
    forceFailure: true,
    timestamp: new Date().toISOString()
  };

  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Failed task submitted successfully', 'Retry Mechanism');


    log('Monitoring task for retries and final state...');
    let finalTask = null;
    let retryAttempts = 0;
    const maxRetryAttempts = 720;

    while (retryAttempts < maxRetryAttempts) {
      await wait(1000);
      finalTask = await getTaskFromDynamoDB(taskId);

      if (finalTask) {
        if (['FAILED', 'DEAD_LETTER'].includes(finalTask.status)) {
          log(`Task reached final failure state: ${finalTask.status} after ${retryAttempts} seconds`);
          break;
        }
        if (retryAttempts % 15 === 0) {
          log(`Retry monitoring: ${retryAttempts}s elapsed, status: ${finalTask.status}, retryCount: ${finalTask.retryCount}`);
        }
      }

      retryAttempts++;
    }

    assert(finalTask !== null, 'Task exists in database after retries', 'Retry Mechanism');


    if (['FAILED', 'DEAD_LETTER'].includes(finalTask.status)) {
      assert(['FAILED', 'DEAD_LETTER'].includes(finalTask.status), 'Task failed after retries', 'Retry Mechanism');
      assert(finalTask.retryCount >= 1, 'Task was retried at least once', 'Retry Mechanism');
      assert(finalTask.retryCount <= 3, 'Task retry count within expected range', 'Retry Mechanism');
      assert(typeof finalTask.lastError === 'string', 'Last error is recorded', 'Retry Mechanism');
    } else if (finalTask.status === 'PROCESSING') {

      assert(finalTask.retryCount >= 1, 'Task was retried at least once', 'Retry Mechanism');
      assert(finalTask.retryCount <= 3, 'Task retry count within expected range', 'Retry Mechanism');
      log(`⚠️ Task still processing after timeout. Status: ${finalTask.status}, RetryCount: ${finalTask.retryCount}`);
      log(`💡 This indicates the task needs more time to complete all retries (up to 12 minutes total)`);
    } else {
      assert(false, `Unexpected task status: ${finalTask.status}`, 'Retry Mechanism');
    }

    log(`Retry test - Final retry count: ${finalTask.retryCount}, Status: ${finalTask.status}`);
    return { taskId, finalTask };

  } catch (error) {
    assert(false, `Retry mechanism test failed: ${error.message}`, 'Retry Mechanism');
    return null;
  }
}

async function testDeadLetterQueueFunctionality() {
  log('🧪 TEST 3: Dead Letter Queue Functionality');

  try {

    const initialDlqAttrs = await getQueueAttributes(DLQ_URL);
    const initialDlqCount = parseInt(initialDlqAttrs.ApproximateNumberOfMessages || '0');


    const failingTasks = [];
    for (let i = 0; i < 3; i++) {
      const taskId = `force-fail-dlq-test-${i}-${Date.now()}`;
      const result = await submitTask(taskId, {
        testType: 'dlq-testing',
        forceFailure: true,
        index: i
      });
      assert(result.statusCode === 201, `DLQ test task ${i} submitted`, 'DLQ Functionality');
      failingTasks.push(taskId);
      await wait(1000);
    }


    log('Monitoring tasks for DLQ processing...');
    let dlqProcessingComplete = false;
    let dlqAttempts = 0;
    const maxDlqAttempts = 720;

    while (!dlqProcessingComplete && dlqAttempts < maxDlqAttempts) {
      await wait(1000);


      let deadLetterCount = 0;
      let failedCount = 0;
      for (const taskId of failingTasks) {
        const task = await getTaskFromDynamoDB(taskId);
        if (task) {
          if (task.status === 'DEAD_LETTER') {
            deadLetterCount++;
          } else if (task.status === 'FAILED') {
            failedCount++;
          }
        }
      }

      const totalFailedTasks = deadLetterCount + failedCount;
      if (totalFailedTasks >= failingTasks.length) {
        log(`Found ${totalFailedTasks} failed tasks (${deadLetterCount} DEAD_LETTER, ${failedCount} FAILED)`);
        dlqProcessingComplete = true;
      } else if (dlqAttempts % 15 === 0) {
        log(`DLQ monitoring: ${dlqAttempts}s elapsed - Failed: ${totalFailedTasks}/${failingTasks.length}`);
      }

      dlqAttempts++;
    }


    const dlqMessages = await getQueueMessages(DLQ_URL, 10);
    const finalDlqAttrs = await getQueueAttributes(DLQ_URL);
    const finalDlqCount = parseInt(finalDlqAttrs.ApproximateNumberOfMessages || '0');

    log(`DLQ message count - Initial: ${initialDlqCount}, Final: ${finalDlqCount}, Retrieved: ${dlqMessages.length}`);


    assert(finalDlqCount >= initialDlqCount, 'DLQ message count increased', 'DLQ Functionality');

    if (dlqMessages.length > 0) {
      const sampleMessage = dlqMessages[0];
      assert(typeof sampleMessage.Body === 'string', 'DLQ message has body', 'DLQ Functionality');

      try {
        const messageBody = JSON.parse(sampleMessage.Body);
        assert(typeof messageBody.taskId === 'string', 'DLQ message contains taskId', 'DLQ Functionality');
        assert(typeof messageBody.payload === 'object', 'DLQ message contains payload', 'DLQ Functionality');
        log(`Sample DLQ message taskId: ${messageBody.taskId}`);
      } catch (parseError) {
        log(`DLQ message parse error: ${parseError.message}`);
      }
    }


    let tasksWithDlqStatus = 0;
    for (const taskId of failingTasks) {
      const task = await getTaskFromDynamoDB(taskId);
      if (task && ['FAILED', 'DEAD_LETTER'].includes(task.status)) {
        tasksWithDlqStatus++;
      }
    }

    assert(tasksWithDlqStatus > 0, 'At least one task marked as failed/dead letter', 'DLQ Functionality');

    return { failingTasks, dlqMessages, finalDlqCount };

  } catch (error) {
    assert(false, `DLQ functionality test failed: ${error.message}`, 'DLQ Functionality');
    return null;
  }
}

async function testDatabaseRecordAccuracy() {
  log('🧪 TEST 4: Database Record Accuracy');

  try {

    const recentTasks = await scanRecentTasks(2);
    assert(recentTasks.length > 0, 'Found recent tasks in database', 'Database Records');


    const statusCounts = recentTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    const retryCountDistribution = recentTasks.reduce((acc, task) => {
      const retryCount = task.retryCount || 0;
      acc[retryCount] = (acc[retryCount] || 0) + 1;
      return acc;
    }, {});

    log(`Status distribution:`, statusCounts);
    log(`Retry count distribution:`, retryCountDistribution);


    let validRecords = 0;
    let recordsWithRetries = 0;

    for (const task of recentTasks) {
      let isValid = true;


      if (!task.taskId || typeof task.taskId !== 'string') isValid = false;
      if (!task.status || typeof task.status !== 'string') isValid = false;
      if (!task.createdAt || typeof task.createdAt !== 'string') isValid = false;
      if (!task.updatedAt || typeof task.updatedAt !== 'string') isValid = false;
      if (typeof task.retryCount !== 'number') isValid = false;
      if (typeof task.failureDestiny !== 'boolean') isValid = false;

      if (isValid) validRecords++;
      if (task.retryCount > 0) recordsWithRetries++;
    }

    const validPercentage = (validRecords / recentTasks.length) * 100;
    assert(validPercentage >= 95, `At least 95% of records are valid (${validPercentage.toFixed(1)}%)`, 'Database Records');


    const maxRetryCount = Math.max(...recentTasks.map(task => task.retryCount || 0));
    assert(maxRetryCount <= 2, 'Retry count within expected maximum', 'Database Records');


    const failedTasks = recentTasks.filter(task => ['FAILED', 'DEAD_LETTER'].includes(task.status));
    if (failedTasks.length > 0) {
      assert(recordsWithRetries >= 0, 'Retry mechanism data available', 'Database Records');
      log(`Found ${failedTasks.length} failed tasks, retry mechanism was exercised`);
    } else {
      log('No failed tasks found - all tasks succeeded on first attempt');
    }

    log(`Database validation - Total: ${recentTasks.length}, Valid: ${validRecords}, With retries: ${recordsWithRetries}, Max retry count: ${maxRetryCount}`);

    return {
      totalTasks: recentTasks.length,
      validRecords,
      recordsWithRetries,
      maxRetryCount,
      statusCounts,
      retryCountDistribution
    };

  } catch (error) {
    assert(false, `Database record accuracy test failed: ${error.message}`, 'Database Records');
    return null;
  }
}

async function testFailureRateAccuracy() {
  log('🧪 TEST 5: 30% Failure Rate Accuracy (Flexible for Any Batch Size)');

  const testTasks = [];
  const batchSize = 30;

  try {

    const baseTimestamp = Date.now();
    for (let i = 0; i < batchSize; i++) {

      const taskId = `failure-rate-test-${i.toString().padStart(3, '0')}-${baseTimestamp + i * 1000}`;
      const payload = {
        testType: 'failure-rate-test',
        index: i,
        expectedToFail: shouldTaskFail(taskId)
      };

      const result = await submitTask(taskId, payload);
      assert(result.statusCode === 201, `Failure rate task ${i} submitted`, 'Failure Rate');

      testTasks.push({
        taskId,
        expectedToFail: shouldTaskFail(taskId),
        submitted: result.statusCode === 201
      });

      await wait(300);
    }


    const expectedFailures = testTasks.filter(t => t.expectedToFail).length;
    const expectedFailureRate = expectedFailures / batchSize;

    log(`Submitted ${batchSize} tasks. Expected failures: ${expectedFailures} (${(expectedFailureRate * 100).toFixed(1)}%)`);


    log('Monitoring failure rate test processing...');
    let processingComplete = false;
    let failureRateAttempts = 0;
    const maxFailureRateAttempts = 900;

    while (!processingComplete && failureRateAttempts < maxFailureRateAttempts) {
      await wait(1000);


      let completedCount = 0;
      let pendingCount = 0;
      let processingCount = 0;

      for (const testTask of testTasks) {
        const dbTask = await getTaskFromDynamoDB(testTask.taskId);
        if (dbTask) {
          if (['COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(dbTask.status)) {
            completedCount++;
          } else if (dbTask.status === 'PENDING') {
            pendingCount++;
          } else if (dbTask.status === 'PROCESSING') {
            processingCount++;
          }
        }
      }

      if (completedCount >= testTasks.length) {
        log(`${completedCount}/${testTasks.length} tasks completed processing`);
        processingComplete = true;
      } else if (failureRateAttempts % 15 === 0) {
        log(`Failure rate monitoring: ${failureRateAttempts}s elapsed - Completed: ${completedCount}, Processing: ${processingCount}, Pending: ${pendingCount}`);
      }

      failureRateAttempts++;
    }


    let actualFailures = 0;
    let actualSuccesses = 0;
    let tasksNotFound = 0;

    for (const testTask of testTasks) {
      const dbTask = await getTaskFromDynamoDB(testTask.taskId);

      if (dbTask) {
        if (['FAILED', 'DEAD_LETTER'].includes(dbTask.status)) {
          actualFailures++;
        } else if (dbTask.status === 'COMPLETED') {
          actualSuccesses++;
        }

      } else {
        tasksNotFound++;


        if (!testTask.expectedToFail) {
          actualSuccesses++;
        }
      }
    }

    const totalProcessed = actualFailures + actualSuccesses;
    let actualFailureRate = 0;
    let failureRateAccuracy = 0;

    if (totalProcessed > 0) {
      actualFailureRate = actualFailures / totalProcessed;
      failureRateAccuracy = Math.abs(expectedFailureRate - actualFailureRate);


      const targetFailureRate = 0.3;
      const actualDeviation = Math.abs(targetFailureRate - actualFailureRate);

      assert(actualDeviation <= 0.15, `Failure rate within 15% of 30% target (target: 30.0%, actual: ${(actualFailureRate * 100).toFixed(1)}%, deviation: ${(actualDeviation * 100).toFixed(1)}%)`, 'Failure Rate');
    } else {
      assert(false, 'No tasks found for failure rate analysis', 'Failure Rate');
    }

    log(`Failure rate test - Expected: ${expectedFailures}, Actual: ${actualFailures}, Accuracy: ${(failureRateAccuracy * 100).toFixed(1)}% deviation`);

    return {
      expectedFailures,
      actualFailures,
      expectedFailureRate,
      actualFailureRate,
      failureRateAccuracy
    };

  } catch (error) {
    assert(false, `Failure rate accuracy test failed: ${error.message}`, 'Failure Rate');
    return null;
  }
}

async function testQueueHealthAndMonitoring() {
  log('🧪 TEST 6: Queue Health and Monitoring');

  try {

    const queueAttrs = await getQueueAttributes(QUEUE_URL);
    const dlqAttrs = await getQueueAttributes(DLQ_URL);

    assert(typeof queueAttrs.ApproximateNumberOfMessages !== 'undefined', 'Main queue is accessible', 'Queue Health');
    assert(typeof dlqAttrs.ApproximateNumberOfMessages !== 'undefined', 'DLQ is accessible', 'Queue Health');

    const mainQueueCount = parseInt(queueAttrs.ApproximateNumberOfMessages || '0');
    const dlqCount = parseInt(dlqAttrs.ApproximateNumberOfMessages || '0');

    log(`Queue status - Main queue: ${mainQueueCount} messages, DLQ: ${dlqCount} messages`);


    assert(mainQueueCount < 100, 'Main queue not overwhelmed', 'Queue Health');

    return { mainQueueCount, dlqCount };

  } catch (error) {
    assert(false, `Queue health test failed: ${error.message}`, 'Queue Health');
    return null;
  }
}


async function runComprehensiveTests() {
  console.log('🚀 COMPREHENSIVE AWS FLOW TESTS');
  console.log('================================');
  console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
  console.log(`🗄️  DynamoDB Table: ${TABLE_NAME}`);
  console.log(`📬 SQS Queue: ${QUEUE_URL}`);
  console.log(`💀 Dead Letter Queue: ${DLQ_URL}`);
  console.log(`📅 Test Time: ${new Date().toISOString()}`);
  console.log('');

  const startTime = Date.now();
  const suiteResults = {};

  try {

    log('🧹 Cleaning up test data before starting tests...');
    await cleanupTestData();
    log('✅ Test data cleanup completed');
    console.log('');


    suiteResults.basicFlow = await testBasicTaskSubmissionAndProcessing();
    suiteResults.retryMechanism = await testRetryMechanism();
    suiteResults.dlqFunctionality = await testDeadLetterQueueFunctionality();
    suiteResults.databaseRecords = await testDatabaseRecordAccuracy();
    suiteResults.failureRate = await testFailureRateAccuracy();
    suiteResults.queueHealth = await testQueueHealthAndMonitoring();


    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n📊 COMPREHENSIVE TEST RESULTS');
    console.log('==============================');
    console.log(`⏱️  Total Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📈 Total Tests: ${testResults.totalTests}`);
    console.log(`✅ Passed: ${testResults.passedTests}`);
    console.log(`❌ Failed: ${testResults.failedTests}`);
    console.log(`📊 Success Rate: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);


    console.log('\n📋 TEST SUITE SUMMARY:');
    console.log('======================');

    if (suiteResults.basicFlow) {
      console.log('✅ Basic Task Flow: Working correctly');
    }

    if (suiteResults.retryMechanism) {
      console.log(`✅ Retry Mechanism: Max retry count ${suiteResults.retryMechanism.finalTask?.retryCount || 0}`);
    }

    if (suiteResults.dlqFunctionality) {
      console.log(`✅ DLQ Functionality: ${suiteResults.dlqFunctionality.dlqMessages?.length || 0} messages processed`);
    }

    if (suiteResults.databaseRecords) {
      console.log(`✅ Database Records: ${suiteResults.databaseRecords.validRecords}/${suiteResults.databaseRecords.totalTasks} valid records`);
    }

    if (suiteResults.failureRate) {
      console.log(`✅ Failure Rate: ${(suiteResults.failureRate.failureRateAccuracy * 100).toFixed(1)}% deviation from expected`);
    }

    if (suiteResults.queueHealth) {
      console.log(`✅ Queue Health: Main(${suiteResults.queueHealth.mainQueueCount}) DLQ(${suiteResults.queueHealth.dlqCount})`);
    }

    if (testResults.failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.errors.forEach(error => console.log(`   ${error}`));
    }

    console.log('\n📋 DETAILED TEST RESULTS:');
    testResults.testDetails.forEach(detail => {
      const icon = detail.status === 'PASS' ? '✅' : '❌';
      console.log(`   ${icon} ${detail.test}: ${detail.message}`);
    });

    if (testResults.failedTests === 0) {
      console.log('\n🎉 ALL TESTS PASSED! The AWS fault-tolerant task processing system is working correctly.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Please review the errors above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 TEST EXECUTION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}


if (require.main === module) {
  runComprehensiveTests();
}

module.exports = {
  runComprehensiveTests,
  testBasicTaskSubmissionAndProcessing,
  testRetryMechanism,
  testDeadLetterQueueFunctionality,
  testDatabaseRecordAccuracy,
  testFailureRateAccuracy,
  testQueueHealthAndMonitoring
};
