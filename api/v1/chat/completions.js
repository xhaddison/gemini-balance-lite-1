// API Endpoint: /api/v1/chat/completions
// Handles the submission of new chat tasks with idempotency support.

import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

// --- Redis Client Initialization (re-usable) ---
let redis;
function getRedisClient() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      // This is a server configuration error, so we throw.
      throw new Error('Server configuration error: Redis connection credentials are not set.');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

// --- Constants for Redis Keys ---
const IDEMPOTENCY_KEY_PREFIX = 'idem_';
const JOB_KEY_PREFIX = 'job_';
const TASK_QUEUE_NAME = 'tasks_queue';
const IDEMPOTENCY_EXPIRATION_SECONDS = 24 * 60 * 60; // 24 hours

// --- The Main, Idempotent Task Submission Handler ---
export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), { status: 405 });
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return new Response(JSON.stringify({ error: { message: 'Idempotency-Key header is required.', type: 'invalid_request_error' } }), { status: 400 });
  }

  try {
    const redisClient = getRedisClient();
    const idemRedisKey = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;

    // 1. Check if we've processed this idempotency key before.
    const existingJobId = await redisClient.get(idemRedisKey);

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
    const tx = redisClient.multi();
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
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + error.message, type: 'invalid_request_error' } }), { status: 400 });
    }
    console.error('[CompletionsHandler] Critical unhandled error:', error);
    return new Response(JSON.stringify({ error: { message: 'Internal Server Error.', type: 'internal_error' } }), { status: 500 });
  }
}
