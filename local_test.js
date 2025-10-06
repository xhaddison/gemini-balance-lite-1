
// local_test.js
// A script to simulate the Vercel production environment locally
// and directly invoke our handler to get a clear, local error message.

import 'dotenv/config';
import handler from './api/v1/chat/completions.js';

// Mock the Request object that Vercel provides to the edge function
class MockRequest {
  constructor(body) {
    this.method = 'POST';
    this._body = body;
  }

  json() {
    return Promise.resolve(this._body);
  }
}

async function runLocalTest() {
  console.log('--- Starting Local Production Simulation ---');

  // Ensure environment variables are loaded
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('FATAL: Could not load Redis credentials from .env.development.local');
    console.error('Please ensure the file exists and is correctly formatted.');
    return;
  }

  // 1. Construct the mock request, identical to our curl command
  const mockRequestBody = {
    model: 'gpt-3.5-turbo',
    messages: [{
      role: 'user',
      content: 'Hello, world. This is the final local judgment.'
    }]
  };
  const mockRequest = new MockRequest(mockRequestBody);

  console.log('Invoking handler with mock request...');

  try {
    // 2. Directly call the handler
    const response = await handler(mockRequest);

    // 3. Analyze the response
    console.log(`Handler returned status: ${response.status}`);
    const responseBody = await response.text(); // Use text() to get raw body
    console.log('Handler returned body:');
    console.log(responseBody);

  } catch (error) {
    console.error('--- FATAL: The handler threw a critical unhandled exception ---');
    console.error(error);
  }

  console.log('--- Local Production Simulation Complete ---');
}

runLocalTest();
