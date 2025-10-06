// local_test_async.js
// A script to simulate the Vercel production environment locally
// and directly invoke our new asynchronous completions handler to find the runtime error.

import 'dotenv/config';
import handler from './api/v1/chat/completions.js';
import { v4 as uuidv4 } from 'uuid';

// A mock Request class that mimics the Vercel/Fetch API Request object
class MockRequest {
  constructor(method, headers, body) {
    this.method = method;
    this.headers = new Map(Object.entries(headers));
    this.body = body;
  }

  async json() {
    return JSON.parse(this.body);
  }

  headers_get(key) {
      return this.headers.get(key)
  }
}

async function runTest() {
  console.log('--- Starting Local Asynchronous Production Simulation ---');

  // 1. Construct the mock request, identical to our curl command
  const idempotencyKey = uuidv4();
  const body = {
    model: 'gpt-3.5-turbo',
    messages: [{
      role: 'user',
      content: 'Hello, world. This is a local test.'
    }],
  };
  const mockRequest = new MockRequest(
    'POST', {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    JSON.stringify(body)
  );

  console.log(`Invoking handler with Idempotency-Key: ${idempotencyKey}`);

  // 2. Directly invoke the handler
  try {
    const response = await handler(mockRequest);
    const responseBody = await response.json();
    console.log('--- Simulation Finished ---');
    console.log(`Handler returned status: ${response.status}`);
    console.log('Handler returned body:', responseBody);
  } catch (error) {
    console.error('--- Simulation Crashed ---');
    console.error('A critical error occurred while invoking the handler:', error);
  }
}

runTest();
