const https = require('https');


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';
const { spawn } = require('child_process');


function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          const parsedData = responseData ? JSON.parse(responseData) : {};
          resolve({
            statusCode: res.statusCode,
            data: parsedData,
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            data: responseData,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function getTaskFromDynamoDB(taskId) {
  return new Promise((resolve) => {
    const process = spawn('aws', [
      'dynamodb',
      'get-item',
      '--table-name',
      'fault-tolerant-service-tasks-dev',
      '--key',
      JSON.stringify({ taskId: { S: taskId } }),
      '--region',
      'us-east-1'
    ]);

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0 || stderr) {
        console.error(`Error getting task ${taskId}:`, stderr);
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (!result.Item) {
          resolve(null);
          return;
        }

        resolve({
          taskId: result.Item.taskId.S,
          status: result.Item.status.S,
          retryCount: parseInt(result.Item.retryCount?.N || '0'),
          failureDestiny: result.Item.failureDestiny?.BOOL || false,
          expectedToFail: result.Item.expectedToFail?.BOOL || false,
          createdAt: result.Item.createdAt?.S,
          updatedAt: result.Item.updatedAt?.S,
        });
      } catch (error) {
        console.error(`Error parsing task ${taskId}:`, error.message);
        resolve(null);
      }
    });
  });
}


async function testStrictFailureRate() {
  console.log('🎯 STRICT 30% FAILURE RATE TEST');
  console.log('================================');
  console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
  console.log(`📅 Test Time: ${new Date().toISOString()}`);
  console.log('');


  const testTasks = [];
  const numTasks = 25;
  
  console.log(`📤 Submitting ${numTasks} test tasks...`);
  
  for (let i = 0; i < numTasks; i++) {
    const taskId = `test-${String(i).padStart(3, '0')}-${Date.now()}`;
    const payload = {
      testType: 'failure-rate-testing',
      taskIndex: i,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await makeRequest(`${API_ENDPOINT}/submit-task`, 'POST', {
        taskId,
        payload,
      });

      if (response.statusCode === 201) {
        testTasks.push({ taskId, expectedIndex: i });
        console.log(`✅ Task ${i}: ${taskId} submitted`);
      } else {
        console.log(`❌ Task ${i}: Failed to submit (${response.statusCode})`);
      }
    } catch (error) {
      console.log(`❌ Task ${i}: Error - ${error.message}`);
    }


    await wait(100);
  }


  let expectedFailuresForBatch = 0;
  for (let i = 0; i < testTasks.length; i++) {
    const position = i % 10;
    if (position === 0 || position === 3 || position === 6) {
      expectedFailuresForBatch++;
    }
  }

  console.log(`\n📊 Submitted ${testTasks.length}/${numTasks} tasks successfully`);
  console.log(`🎯 Expected failures: ${expectedFailuresForBatch} (${(expectedFailuresForBatch/testTasks.length*100).toFixed(1)}%)`);
  console.log('⏳ Waiting for processing to complete...');


  let allCompleted = false;
  let attempts = 0;
  const maxAttempts = 450;

  while (!allCompleted && attempts < maxAttempts) {
    await wait(1000);
    attempts++;

    let completedCount = 0;
    let processingCount = 0;
    let pendingCount = 0;

    for (const testTask of testTasks) {
      const dbTask = await getTaskFromDynamoDB(testTask.taskId);
      if (dbTask) {
        if (['COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(dbTask.status)) {
          completedCount++;
        } else if (dbTask.status === 'PROCESSING') {
          processingCount++;
        } else if (dbTask.status === 'PENDING') {
          pendingCount++;
        }
      }
    }

    if (completedCount >= testTasks.length) {
      allCompleted = true;
      console.log(`✅ Processing complete: ${completedCount}/${testTasks.length} tasks finished`);
    } else if (attempts % 30 === 0) {
      console.log(`⏳ Progress: ${completedCount} completed, ${processingCount} processing, ${pendingCount} pending (${attempts}s elapsed)`);
    }
  }


  console.log('\n📊 ANALYZING RESULTS...');
  
  let successCount = 0;
  let failureCount = 0;
  const results = [];

  for (const testTask of testTasks) {
    const dbTask = await getTaskFromDynamoDB(testTask.taskId);
    if (dbTask) {
      const expectedToFail = testTask.expectedIndex % 10 === 0 || testTask.expectedIndex % 10 === 3 || testTask.expectedIndex % 10 === 6;
      const actuallyFailed = ['FAILED', 'DEAD_LETTER'].includes(dbTask.status);
      
      results.push({
        index: testTask.expectedIndex,
        taskId: testTask.taskId,
        expectedToFail,
        actuallyFailed,
        status: dbTask.status,
        failureDestiny: dbTask.failureDestiny,
        retryCount: dbTask.retryCount,
      });

      if (actuallyFailed) {
        failureCount++;
      } else {
        successCount++;
      }
    }
  }


  results.sort((a, b) => a.index - b.index);

  console.log('\n📋 DETAILED RESULTS:');
  console.log('Index | Expected | Actual   | Status      | Destiny | Retries | ✓/❌');
  console.log('------|----------|----------|-------------|---------|---------|-----');
  
  let correctPredictions = 0;
  for (const result of results) {
    const correct = result.expectedToFail === result.actuallyFailed;
    if (correct) correctPredictions++;
    
    console.log(
      `${String(result.index).padStart(5)} | ` +
      `${result.expectedToFail ? 'FAIL    ' : 'SUCCESS '}| ` +
      `${result.actuallyFailed ? 'FAIL    ' : 'SUCCESS '}| ` +
      `${result.status.padEnd(11)} | ` +
      `${result.failureDestiny ? 'true   ' : 'false  '}| ` +
      `${String(result.retryCount).padStart(7)} | ` +
      `${correct ? '✅' : '❌'}`
    );
  }


  const actualFailureRate = failureCount / testTasks.length;

  let expectedFailures = 0;
  for (let i = 0; i < testTasks.length; i++) {
    const position = i % 10;
    if (position === 0 || position === 3 || position === 6) {
      expectedFailures++;
    }
  }
  const expectedFailureRate = expectedFailures / testTasks.length;
  const accuracy = correctPredictions / testTasks.length;

  console.log('\n🎯 FINAL RESULTS:');
  console.log('================');
  console.log(`📊 Total Tasks: ${testTasks.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`📈 Actual Failure Rate: ${(actualFailureRate * 100).toFixed(1)}%`);
  console.log(`🎯 Expected Failure Rate: ${(expectedFailureRate * 100).toFixed(1)}%`);
  console.log(`🎯 Prediction Accuracy: ${(accuracy * 100).toFixed(1)}%`);


  const isExact30Percent = actualFailureRate === expectedFailureRate;
  const isPerfectAccuracy = accuracy === 1.0;

  console.log('\n🏆 TEST RESULTS:');
  if (isExact30Percent && isPerfectAccuracy) {
    console.log('✅ PERFECT! Exactly 30% failure rate with 100% prediction accuracy');
    return true;
  } else {
    console.log('❌ FAILED:');
    if (!isExact30Percent) {
      console.log(`   - Failure rate is ${(actualFailureRate * 100).toFixed(1)}%, expected exactly 30.0%`);
    }
    if (!isPerfectAccuracy) {
      console.log(`   - Prediction accuracy is ${(accuracy * 100).toFixed(1)}%, expected 100.0%`);
    }
    return false;
  }
}


testStrictFailureRate()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  });
