const https = require('https');


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';


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

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}


async function testFailureRates() {
  console.log('🧪 FAILURE RATE VERIFICATION TESTS');
  console.log('==================================');
  
  const testCases = [
    { batchSize: 1, expectedMax: 1, description: '1 task: should be 0-1 failures (≤100%)' },
    { batchSize: 3, expectedMax: 1, description: '3 tasks: should be ≤1 failure (≤33%)' },
    { batchSize: 9, expectedMax: 3, description: '9 tasks: should be ≤3 failures (≤33%)' },
    { batchSize: 10, expectedMax: 3, description: '10 tasks: should be ≤3 failures (≤30%)' },
    { batchSize: 100, expectedMax: 30, description: '100 tasks: should be ≤30 failures (≤30%)' },
    { batchSize: 1000, expectedMax: 300, description: '1000 tasks: should be ≤300 failures (≤30%)' }
  ];
  
  for (const testCase of testCases) {
    await testBatchSize(testCase);
  }
}

async function testBatchSize({ batchSize, expectedMax, description }) {
  log(`\n🧪 Testing: ${description}`);
  
  const failures = [];
  const successes = [];
  

  const baseTimestamp = Date.now();
  for (let i = 0; i < batchSize; i++) {
    const taskId = `batch-${batchSize}-task-${i.toString().padStart(6, '0')}-${baseTimestamp + i * 1000}`;
    const shouldFail = shouldTaskFail(taskId);

    if (shouldFail) {
      failures.push(taskId);
    } else {
      successes.push(taskId);
    }
  }
  
  const actualFailures = failures.length;
  const actualFailureRate = (actualFailures / batchSize) * 100;
  const maxAllowedRate = (expectedMax / batchSize) * 100;
  

  console.log(`📊 Batch Size: ${batchSize}`);
  console.log(`📊 Expected Max Failures: ${expectedMax} (${maxAllowedRate.toFixed(1)}%)`);
  console.log(`📊 Actual Failures: ${actualFailures} (${actualFailureRate.toFixed(1)}%)`);
  console.log(`📊 Success Count: ${successes.length} (${((successes.length / batchSize) * 100).toFixed(1)}%)`);
  

  if (actualFailures <= expectedMax) {
    console.log(`✅ PASS: Failure rate within expected limit`);
  } else {
    console.log(`❌ FAIL: Failure rate exceeds limit (${actualFailures} > ${expectedMax})`);
  }
  

  console.log(`📋 Sample Results:`);
  const sampleSize = Math.min(10, batchSize);
  const sampleTimestamp = Date.now();
  for (let i = 0; i < sampleSize; i++) {
    const taskId = `batch-${batchSize}-task-${i.toString().padStart(6, '0')}-${sampleTimestamp + i * 1000}`;
    const shouldFail = shouldTaskFail(taskId);
    const hash = calculateHash(taskId);
    const hashValue = Math.abs(hash) % 100000;
    console.log(`   Task ${i}: ${shouldFail ? 'FAIL' : 'SUCCESS'} (hash%100000=${hashValue})`);
  }
  
  return {
    batchSize,
    actualFailures,
    actualFailureRate,
    expectedMax,
    maxAllowedRate,
    passed: actualFailures <= expectedMax
  };
}

function calculateHash(taskId) {
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < taskId.length; i++) {
    const char = taskId.charCodeAt(i);
    hash1 = (hash1 << 5) - hash1 + char;
    hash2 = (hash2 << 3) - hash2 + char * 31;
  }
  return Math.abs(hash1 ^ hash2);
}


async function main() {
  try {
    await testFailureRates();
    
    console.log('\n📊 VERIFICATION COMPLETE');
    console.log('========================');
    console.log('All batch sizes tested for failure rate compliance.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
