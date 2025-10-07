// API Endpoint: /api/v1/chat/completions
// Handles the submission of new chat tasks with idempotency support.

import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

// --- Environment Variable Validation ---
// Ensure that the necessary environment variables for Redis are set before
// attempting to initialize the client. This prevents cryptic startup failures.
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error('FATAL: Server configuration error. UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN environment variables are not set.');
}

// --- Redis Client Initialization ---
// As per Upstash's recommendation for Vercel Serverless Functions, the client
// is initialized once in the global scope. This allows connection reuse
// across function invocations.
const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- Constants for Redis Keys ---
const IDEMPOTENCY_KEY_PREFIX = 'idem_';
const JOB_KEY_PREFIX = 'job_';
const TASK_QUEUE_NAME = 'tasks_queue';
const IDEMPOTENCY_EXPIRATION_SECONDS = 24 * 60 * 60; // 24 hours

// --- The Main, Idempotent Task Submission Handler ---
export default async function handler(request) {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), { status: 405 });
    }

    // Vercel normalizes header names to lowercase.
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return new Response(JSON.stringify({ error: { message: 'Idempotency-Key header is required.', type: 'invalid_request_error' } }), { status: 400 });
    }

    const redis = redisClient;
    const idemRedisKey = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;

    // 1. Check if we've processed this idempotency key before.
    const existingJobId = await redis.get(idemRedisKey);

    if (existingJobId) {
      // This is a retry. Return the original jobId.
      return new Response(JSON.stringify({ jobId: existingJobId }), {
        status: 200, // OK, since we are successfully returning the identifier for the original resource.
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. This is a new request.
    const requestBody = await request.json(); // Parse the body only for new requests.
    const jobId = uuidv4();
    const jobRedisKey = `${JOB_KEY_PREFIX}${jobId}`;

    const task = {
      jobId,
      originalBody: requestBody,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };

    // 3. Atomically save the idempotency mapping and the new job, then queue it.
    const tx = redis.multi();
    tx.setex(idemRedisKey, IDEMPOTENCY_EXPIRATION_SECONDS, jobId); // Set idempotency key -> jobId mapping
    tx.json.set(jobRedisKey, '$', task); // Store the full job details
    tx.lpush(TASK_QUEUE_NAME, JSON.stringify({ jobId })); // Push jobId to worker queue
    await tx.exec();

    // 4. Return the new jobId to the client.
    return new Response(JSON.stringify({ jobId }), {
      status: 202, // Accepted for processing.
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('An unexpected error occurred:', error);

    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + error.message, type: 'invalid_request_error' } }), { status: 400 });
    }

    // Return a generic server error response.
    return new Response(JSON.stringify({
        error: {
            message: 'Internal Server Error.',
            type: 'internal_error',
        }
    }), { status: 500 });
  }
}
