const https = require('https');


const API_ENDPOINT = 'https://xmfkjn2blb.execute-api.us-east-1.amazonaws.com/dev';

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}


function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_ENDPOINT + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedData,
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseData,
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


async function testBasicFunctionality() {
  console.log('🧪 BASIC FUNCTIONALITY TEST');
  console.log('===========================');

  const taskId = `basic-test-${Date.now()}`;
  const payload = { message: 'Test basic functionality', timestamp: Date.now() };

  log(`Testing basic functionality with taskId: ${taskId}`);

  try {

    log('📤 Sending request...');
    const response = await makeRequest('/submit-task', 'POST', {
      taskId,
      payload,
    });
    
    log(`📥 Response: ${response.statusCode}`);
    console.log('Response body:', JSON.stringify(response.body, null, 2));


    console.log('\n� BASIC FUNCTIONALITY ANALYSIS');
    console.log('================================');

    if (response.statusCode === 201) {
      console.log('✅ PASS: Basic functionality working - got 201 status');
      if (response.body && response.body.taskId === taskId) {
        console.log('✅ PASS: Response contains correct taskId');
      } else {
        console.log('❌ FAIL: Response missing or incorrect taskId');
      }
    } else {
      console.log(`❌ FAIL: Unexpected status code: ${response.statusCode}`);
      console.log('Response:', response.body);
    }

    console.log('\n🎯 BASIC FUNCTIONALITY TEST COMPLETE');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}


async function main() {
  try {
    await testBasicFunctionality();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
