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


async function testIdempotency() {
  console.log('🧪 IDEMPOTENCY TEST');
  console.log('==================');
  
  const taskId = `idempotency-test-${Date.now()}`;
  const payload = { message: 'Test idempotency', timestamp: Date.now() };
  
  log(`Testing idempotency with taskId: ${taskId}`);
  
  try {

    log('📤 Sending first request...');
    const response1 = await makeRequest('/submit-task', 'POST', {
      taskId,
      payload,
    });
    
    log(`📥 First response: ${response1.statusCode}`);
    console.log('First response body:', JSON.stringify(response1.body, null, 2));
    console.log('First response headers:', JSON.stringify(response1.headers, null, 2));


    await new Promise(resolve => setTimeout(resolve, 1000));


    log('📤 Sending second request (duplicate)...');
    const response2 = await makeRequest('/submit-task', 'POST', {
      taskId,
      payload,
    });
    
    log(`📥 Second response: ${response2.statusCode}`);
    console.log('Second response body:', JSON.stringify(response2.body, null, 2));
    console.log('Second response headers:', JSON.stringify(response2.headers, null, 2));


    log('📤 Sending third request (different payload)...');
    const response3 = await makeRequest('/submit-task', 'POST', {
      taskId,
      payload: { message: 'Different payload', timestamp: Date.now() },
    });
    
    log(`📥 Third response: ${response3.statusCode}`);
    console.log('Third response body:', JSON.stringify(response3.body, null, 2));


    console.log('\n📊 IDEMPOTENCY ANALYSIS');
    console.log('=======================');

    if (response1.statusCode === 201 && response2.statusCode === 201) {
      if (JSON.stringify(response1.body) === JSON.stringify(response2.body)) {
        console.log('✅ PASS: Idempotency working - same response for duplicate requests');
      } else {
        console.log('❌ FAIL: Different responses for duplicate requests');
        console.log('Response 1:', response1.body);
        console.log('Response 2:', response2.body);
      }


      if (response2.headers['x-idempotency-cached'] === 'true') {
        console.log('✅ PASS: Second response correctly marked as cached');
      } else {
        console.log('⚠️  WARNING: Second response not marked as cached');
      }


      if (response1.headers['x-idempotency-key'] === taskId) {
        console.log('✅ PASS: Idempotency key header present in first response');
      } else {
        console.log('⚠️  WARNING: Idempotency key header missing in first response');
      }
    } else {
      console.log('❌ FAIL: Unexpected status codes');
      console.log(`First request: ${response1.statusCode}`);
      console.log(`Second request: ${response2.statusCode}`);
    }

    if (response3.statusCode === 422) {
      console.log('✅ PASS: Payload validation working - rejected different payload for same taskId');
    } else {
      console.log('⚠️  WARNING: Expected 422 error for different payload');
      console.log(`Third request status: ${response3.statusCode}`);
    }

    console.log('\n🎯 IDEMPOTENCY TEST COMPLETE');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}


async function main() {
  try {
    await testIdempotency();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
