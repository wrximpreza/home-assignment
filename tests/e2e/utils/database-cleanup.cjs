#!/usr/bin/env node

/**
 * Database Cleanup Utility for E2E Tests
 * 
 * This utility cleans up test data before running E2E tests to ensure
 * a clean state and prevent interference between test runs.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, PurgeQueueCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');


const region = 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sqs = new SQSClient({ region });


const TABLE_NAME = 'fault-tolerant-service-tasks-dev';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-queue-dev';
const DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/331473369937/fault-tolerant-service-task-dlq-dev';

function log(message, data = {}) {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length > 0 ? data : '');
}

async function clearDynamoDBTable() {
  log('🗄️  Clearing DynamoDB table...');
  
  try {

    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'taskId',
    });
    
    const result = await dynamodb.send(scanCommand);
    const items = result.Items || [];
    
    if (items.length === 0) {
      log('✅ DynamoDB table is already empty');
      return { deletedCount: 0 };
    }
    
    log(`📊 Found ${items.length} items to delete`);
    

    const batchSize = 25;
    let deletedCount = 0;
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      const deleteRequests = batch.map(item => ({
        DeleteRequest: {
          Key: { taskId: item.taskId },
        },
      }));
      
      const batchCommand = new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: deleteRequests,
        },
      });
      
      await dynamodb.send(batchCommand);
      deletedCount += batch.length;
      
      log(`🗑️  Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);
      

      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    log(`✅ DynamoDB cleanup complete - deleted ${deletedCount} items`);
    return { deletedCount };
    
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      log(`⚠️  DynamoDB table ${TABLE_NAME} not found - skipping cleanup`);
      return { deletedCount: 0 };
    }
    log(`❌ Error clearing DynamoDB table: ${error.message}`);
    throw error;
  }
}

async function clearSQSQueue(queueUrl, queueName) {
  log(`📬 Clearing SQS queue: ${queueName}...`);
  
  try {

    const getAttrsCommand = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    });
    
    const attrs = await sqs.send(getAttrsCommand);
    const visibleMessages = parseInt(attrs.Attributes?.ApproximateNumberOfMessages || '0');
    const invisibleMessages = parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
    const totalMessages = visibleMessages + invisibleMessages;
    
    if (totalMessages === 0) {
      log(`✅ ${queueName} is already empty`);
      return { clearedMessages: 0 };
    }
    
    log(`📊 ${queueName} has ${totalMessages} messages (${visibleMessages} visible, ${invisibleMessages} in-flight)`);
    

    const purgeCommand = new PurgeQueueCommand({
      QueueUrl: queueUrl,
    });
    
    await sqs.send(purgeCommand);
    
    log(`✅ ${queueName} purged successfully`);
    return { clearedMessages: totalMessages };
    
  } catch (error) {
    if (error.name === 'PurgeQueueInProgress') {
      log(`⚠️  ${queueName} purge already in progress, skipping`);
      return { clearedMessages: 0 };
    }

    if (error.name === 'QueueDoesNotExist' || error.message.includes('does not exist')) {
      log(`⚠️  ${queueName} does not exist - skipping cleanup`);
      return { clearedMessages: 0 };
    }

    log(`❌ Error clearing ${queueName}: ${error.message}`);
    throw error;
  }
}

async function waitForQueuePurge(queueUrl, queueName, maxWaitSeconds = 60) {
  log(`⏳ Waiting for ${queueName} purge to complete...`);
  
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const getAttrsCommand = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      });
      
      const attrs = await sqs.send(getAttrsCommand);
      const messageCount = parseInt(attrs.Attributes?.ApproximateNumberOfMessages || '0');
      
      if (messageCount === 0) {
        log(`✅ ${queueName} purge completed`);
        return;
      }
      
      log(`⏳ ${queueName} still has ${messageCount} messages, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      log(`⚠️  Error checking ${queueName} status: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  log(`⚠️  ${queueName} purge timeout after ${maxWaitSeconds} seconds`);
}

async function cleanupTestData() {
  console.log('🧹 STARTING E2E TEST DATA CLEANUP');
  console.log('==================================');
  console.log(`🗄️  DynamoDB Table: ${TABLE_NAME}`);
  console.log(`📬 Main Queue: ${QUEUE_URL}`);
  console.log(`💀 Dead Letter Queue: ${DLQ_URL}`);
  console.log(`📅 Cleanup Time: ${new Date().toISOString()}`);
  console.log('');

  const startTime = Date.now();
  const results = {
    dynamodb: { deletedCount: 0 },
    mainQueue: { clearedMessages: 0 },
    dlq: { clearedMessages: 0 },
  };

  try {

    results.dynamodb = await clearDynamoDBTable();
    

    results.mainQueue = await clearSQSQueue(QUEUE_URL, 'Main Queue');
    results.dlq = await clearSQSQueue(DLQ_URL, 'Dead Letter Queue');
    

    await waitForQueuePurge(QUEUE_URL, 'Main Queue');
    await waitForQueuePurge(DLQ_URL, 'Dead Letter Queue');
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('\n📊 CLEANUP RESULTS');
    console.log('==================');
    console.log(`⏱️  Total Duration: ${duration.toFixed(1)} seconds`);
    console.log(`🗄️  DynamoDB: ${results.dynamodb.deletedCount} items deleted`);
    console.log(`📬 Main Queue: ${results.mainQueue.clearedMessages} messages cleared`);
    console.log(`💀 DLQ: ${results.dlq.clearedMessages} messages cleared`);
    console.log('');
    console.log('✅ E2E test data cleanup completed successfully!');
    
    return results;
    
  } catch (error) {
    console.error('\n💥 CLEANUP FAILED:', error.message);
    console.error(error.stack);
    throw error;
  }
}


if (require.main === module) {
  cleanupTestData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = {
  cleanupTestData,
  clearDynamoDBTable,
  clearSQSQueue,
  waitForQueuePurge,
};
