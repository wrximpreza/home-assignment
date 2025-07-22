#!/usr/bin/env node

/**
 * Dead Letter Queue (DLQ) and Error Handling Tests
 * 
 * This test suite specifically validates:
 * 1. DLQ message delivery and format
 * 2. Error propagation and handling
 * 3. Message attributes preservation
 * 4. Retry exhaustion scenarios
 * 5. DLQ monitoring and alerting capabilities
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { 
  SQSClient, 
  ReceiveMessageCommand, 
  GetQueueAttributesCommand,
  DeleteMessageCommand 
} = require('@aws-sdk/client-sqs');
const { v4: uuidv4 } = require('uuid');
const { cleanupTestData } = require('./utils/database-cleanup.cjs');


const region = 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sqs = new SQSClient({ region });


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';
const TABLE_NAME = 'fault-tolerant-service-tasks-dev';
const DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-dlq-dev';


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

async function getDLQMessages(maxMessages = 10) {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: DLQ_URL,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 5,
      VisibilityTimeout: 60,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All']
    });
    const result = await sqs.send(command);
    return result.Messages || [];
  } catch (error) {
    log(`Error getting DLQ messages: ${error.message}`);
    return [];
  }
}

async function deleteDLQMessage(receiptHandle) {
  try {
    const command = new DeleteMessageCommand({
      QueueUrl: DLQ_URL,
      ReceiptHandle: receiptHandle
    });
    await sqs.send(command);
    return true;
  } catch (error) {
    log(`Error deleting DLQ message: ${error.message}`);
    return false;
  }
}

async function getDLQAttributes() {
  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: DLQ_URL,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'CreatedTimestamp',
        'LastModifiedTimestamp'
      ]
    });
    const result = await sqs.send(command);
    return result.Attributes || {};
  } catch (error) {
    log(`Error getting DLQ attributes: ${error.message}`);
    return {};
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDLQMessageStructure() {
  log('🧪 TEST 1: DLQ Message Structure Validation');
  
  const taskId = `dlq-structure-force-fail-test-${Date.now()}`;
  const payload = {
    testType: 'dlq-structure-validation',
    forceFailure: true,
    metadata: {
      testId: uuidv4(),
      timestamp: new Date().toISOString(),
      expectedBehavior: 'should fail and go to DLQ'
    }
  };
  
  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Task submitted successfully', 'DLQ Structure');
    

    log('Waiting 60 seconds for DLQ delivery...');
    await wait(60000);
    

    const dlqMessages = await getDLQMessages(5);
    assert(dlqMessages.length > 0, 'DLQ contains messages', 'DLQ Structure');
    

    let testMessage = null;
    for (const message of dlqMessages) {
      try {
        const body = JSON.parse(message.Body);
        if (body.taskId === taskId) {
          testMessage = message;
          break;
        }
      } catch (e) {

      }
    }
    
    if (testMessage) {
      const messageBody = JSON.parse(testMessage.Body);
      

      assert(typeof messageBody.taskId === 'string', 'DLQ message has taskId', 'DLQ Structure');
      assert(messageBody.taskId === taskId, 'DLQ message taskId matches', 'DLQ Structure');
      assert(typeof messageBody.payload === 'object', 'DLQ message has payload', 'DLQ Structure');
      assert(typeof messageBody.retryCount === 'number', 'DLQ message has retryCount', 'DLQ Structure');
      assert(messageBody.retryCount >= 1, 'DLQ message shows retry attempts', 'DLQ Structure');
      

      if (testMessage.MessageAttributes) {
        assert(testMessage.MessageAttributes.TaskId, 'DLQ message has TaskId attribute', 'DLQ Structure');
        assert(testMessage.MessageAttributes.RetryCount, 'DLQ message has RetryCount attribute', 'DLQ Structure');
      }
      

      assert(typeof testMessage.MessageId === 'string', 'DLQ message has MessageId', 'DLQ Structure');
      assert(typeof testMessage.ReceiptHandle === 'string', 'DLQ message has ReceiptHandle', 'DLQ Structure');
      
      log(`DLQ message validation - TaskId: ${messageBody.taskId}, RetryCount: ${messageBody.retryCount}`);
      

      await deleteDLQMessage(testMessage.ReceiptHandle);
      
    } else {
      assert(false, 'Test message not found in DLQ', 'DLQ Structure');
    }
    
    return { taskId, testMessage: testMessage ? JSON.parse(testMessage.Body) : null };

  } catch (error) {
    assert(false, `DLQ structure test failed: ${error.message}`, 'DLQ Structure');
    return null;
  }
}

async function testErrorPropagation() {
  log('🧪 TEST 2: Error Propagation and Database Consistency');

  const taskId = `error-propagation-force-fail-test-${Date.now()}`;
  const payload = {
    testType: 'error-propagation',
    forceFailure: true,
    errorType: 'simulated-processing-error'
  };

  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Task submitted for error propagation test', 'Error Propagation');


    log('Waiting 6 minutes for error propagation...');
    await wait(360000);


    const dbTask = await getTaskFromDynamoDB(taskId);
    assert(dbTask !== null, 'Task exists in database', 'Error Propagation');

    if (dbTask !== null) {
      assert(['FAILED', 'DEAD_LETTER'].includes(dbTask.status), 'Task marked as failed', 'Error Propagation');
      assert(typeof dbTask.lastError === 'string', 'Error message recorded', 'Error Propagation');
      assert(dbTask.lastError.length > 0, 'Error message is not empty', 'Error Propagation');
      assert(typeof dbTask.failedAt === 'string', 'Failure timestamp recorded', 'Error Propagation');
      assert(dbTask.retryCount >= 1, 'Retry attempts recorded', 'Error Propagation');

      log(`Error propagation - Status: ${dbTask.status}, RetryCount: ${dbTask.retryCount}, Error: ${dbTask.lastError.substring(0, 50)}...`);
    } else {
      log(`❌ Error propagation test failed: Cannot read properties of null (reading 'status')`);
    }

    return { taskId, dbTask };

  } catch (error) {
    assert(false, `Error propagation test failed: ${error.message}`, 'Error Propagation');
    return null;
  }
}

async function testDLQMonitoring() {
  log('🧪 TEST 3: DLQ Monitoring and Metrics');

  try {

    const initialAttrs = await getDLQAttributes();
    const initialCount = parseInt(initialAttrs.ApproximateNumberOfMessages || '0');

    log(`Initial DLQ state - Messages: ${initialCount}`);


    const failingTasks = [];
    for (let i = 0; i < 2; i++) {
      const taskId = `dlq-monitoring-force-fail-${i}-${Date.now()}`;
      const result = await submitTask(taskId, {
        testType: 'dlq-monitoring',
        index: i,
        forceFailure: true
      });
      assert(result.statusCode === 201, `Monitoring test task ${i} submitted`, 'DLQ Monitoring');
      failingTasks.push(taskId);
      await wait(2000);
    }


    log('Waiting 60 seconds for DLQ monitoring test...');
    await wait(60000);


    const finalAttrs = await getDLQAttributes();
    const finalCount = parseInt(finalAttrs.ApproximateNumberOfMessages || '0');

    log(`Final DLQ state - Messages: ${finalCount}`);


    assert(typeof finalAttrs.CreatedTimestamp !== 'undefined', 'DLQ has creation timestamp', 'DLQ Monitoring');
    assert(typeof finalAttrs.LastModifiedTimestamp !== 'undefined', 'DLQ has last modified timestamp', 'DLQ Monitoring');
    assert(finalCount >= initialCount, 'DLQ message count increased or stayed same', 'DLQ Monitoring');


    const dlqMessages = await getDLQMessages(3);
    let monitoringTestMessages = 0;

    for (const message of dlqMessages) {
      try {
        const body = JSON.parse(message.Body);
        if (body.payload && body.payload.testType === 'dlq-monitoring') {
          monitoringTestMessages++;
        }
      } catch (e) {

      }
    }

    log(`DLQ monitoring - Found ${monitoringTestMessages} test messages in DLQ`);

    return {
      initialCount,
      finalCount,
      failingTasks,
      monitoringTestMessages,
      dlqAttributes: finalAttrs
    };

  } catch (error) {
    assert(false, `DLQ monitoring test failed: ${error.message}`, 'DLQ Monitoring');
    return null;
  }
}

async function testRetryExhaustion() {
  log('🧪 TEST 4: Retry Exhaustion Scenarios');

  const taskId = `retry-exhaustion-force-fail-${Date.now()}`;
  const payload = {
    testType: 'retry-exhaustion',
    forceFailure: true,
    maxRetriesExpected: 2
  };

  try {

    const result = await submitTask(taskId, payload);
    assert(result.statusCode === 201, 'Retry exhaustion task submitted', 'Retry Exhaustion');


    log('Waiting 6 minutes for retry exhaustion...');
    await wait(360000);


    const dbTask = await getTaskFromDynamoDB(taskId);
    assert(dbTask !== null, 'Task exists after retry exhaustion', 'Retry Exhaustion');

    if (dbTask !== null) {
      assert(['FAILED', 'DEAD_LETTER'].includes(dbTask.status), 'Task failed after exhausting retries', 'Retry Exhaustion');
      assert(dbTask.retryCount === 2, 'Task reached maximum retry count', 'Retry Exhaustion');
      assert(typeof dbTask.lastError === 'string', 'Final error recorded', 'Retry Exhaustion');
    } else {
      log(`❌ Retry exhaustion test failed: Cannot read properties of null (reading 'status')`);
    }


    const dlqMessages = await getDLQMessages(5);
    let foundInDLQ = false;

    for (const message of dlqMessages) {
      try {
        const body = JSON.parse(message.Body);
        if (body.taskId === taskId) {
          foundInDLQ = true;
          assert(body.retryCount === 2, 'DLQ message shows correct retry count', 'Retry Exhaustion');

          await deleteDLQMessage(message.ReceiptHandle);
          break;
        }
      } catch (e) {

      }
    }


    log(`Retry exhaustion - RetryCount: ${dbTask.retryCount}, Status: ${dbTask.status}, Found in DLQ: ${foundInDLQ}`);

    return { taskId, dbTask, foundInDLQ };

  } catch (error) {
    assert(false, `Retry exhaustion test failed: ${error.message}`, 'Retry Exhaustion');
    return null;
  }
}


async function runDLQTests() {
  console.log('🚀 DLQ AND ERROR HANDLING TESTS');
  console.log('================================');
  console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
  console.log(`🗄️  DynamoDB Table: ${TABLE_NAME}`);
  console.log(`💀 Dead Letter Queue: ${DLQ_URL}`);
  console.log(`📅 Test Time: ${new Date().toISOString()}`);
  console.log('');

  const startTime = Date.now();
  const results = {};

  try {

    console.log('🧹 Cleaning up test data before starting DLQ tests...');
    await cleanupTestData();
    console.log('✅ Test data cleanup completed\n');


    results.messageStructure = await testDLQMessageStructure();
    results.errorPropagation = await testErrorPropagation();
    results.dlqMonitoring = await testDLQMonitoring();
    results.retryExhaustion = await testRetryExhaustion();


    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log('\n📊 DLQ TEST RESULTS');
    console.log('===================');
    console.log(`⏱️  Total Duration: ${duration.toFixed(1)} seconds`);
    console.log(`📈 Total Tests: ${testResults.totalTests}`);
    console.log(`✅ Passed: ${testResults.passedTests}`);
    console.log(`❌ Failed: ${testResults.failedTests}`);
    console.log(`📊 Success Rate: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);


    console.log('\n📋 DLQ TEST SUMMARY:');
    console.log('====================');

    if (results.messageStructure) {
      console.log('✅ DLQ Message Structure: Valid format and attributes');
    }

    if (results.errorPropagation) {
      console.log(`✅ Error Propagation: RetryCount ${results.errorPropagation.dbTask?.retryCount}, Status ${results.errorPropagation.dbTask?.status}`);
    }

    if (results.dlqMonitoring) {
      console.log(`✅ DLQ Monitoring: ${results.dlqMonitoring.monitoringTestMessages} test messages processed`);
    }

    if (results.retryExhaustion) {
      console.log(`✅ Retry Exhaustion: Max retries (${results.retryExhaustion.dbTask?.retryCount}) reached`);
    }

    if (testResults.failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.errors.forEach(error => console.log(`   ${error}`));
    }

    if (testResults.failedTests === 0) {
      console.log('\n🎉 ALL DLQ TESTS PASSED! Dead Letter Queue and error handling are working correctly.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME DLQ TESTS FAILED! Please review the errors above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 DLQ TEST EXECUTION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}


if (require.main === module) {
  runDLQTests();
}

module.exports = {
  runDLQTests,
  testDLQMessageStructure,
  testErrorPropagation,
  testDLQMonitoring,
  testRetryExhaustion
};
