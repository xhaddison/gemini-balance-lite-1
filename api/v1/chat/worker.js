// API Endpoint: /api/v1/chat/worker
// This is a background worker responsible for processing tasks from the queue.
// It should be triggered by a scheduler (e.g., Vercel Cron Jobs) periodically.

import { Redis } from '@upstash/redis';

// --- Redis Client Initialization (re-usable) ---
let redis;
function getRedisClient() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      throw new Error('Server configuration error: Redis connection credentials are not set.');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

// --- Constants ---
const JOB_KEY_PREFIX = 'job_';
const TASK_QUEUE_NAME = 'tasks_queue';
const KEYS_QUEUE_NAME = 'keys_queue'; // For API keys

// --- Key Manager Logic (migrated from original completions.js) ---
async function getNextKey() {
  try {
    const redisClient = getRedisClient();
    const key = await redisClient.lpop(KEYS_QUEUE_NAME);
    if (!key) {
      console.warn('[Worker] Key queue is empty.');
      return null;
    }
    return key;
  } catch (error) {
    console.error('[Worker] Failed to get next key from Redis:', error);
    return null;
  }
}

async function returnKey(key) {
  if (typeof key !== 'string' || !key) return;
  try {
    await getRedisClient().rpush(KEYS_QUEUE_NAME, key);
  } catch (error) {
    console.error(`[Worker] Failed to return key ${key.substring(0, 4)}... to Redis:`, error);
  }
}

// --- Gemini API Logic (migrated from original completions.js) ---
function convertToGeminiRequest(openaiRequest) {
  const { messages } = openaiRequest;
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const prompt = lastUserMessage?.content ?? '';
  return { contents: [{ parts: [{ text: prompt }] }] };
}

const modelMap = new Map([
    ['gemini-2.5-pro', 'gemini-2.5-pro'],
    ['gemini-2.5-flash', 'gemini-2.5-flash'],
    ['gemini-pro', 'gemini-2.5-pro'],
    ['gemini-1.5-flash', 'gemini-2.5-flash'],
]);

async function fetchWithTimeout(url, options, apiKey) {
  const controller = new AbortController();
  // Give a generous timeout for the upstream, serverless function has a longer limit.
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 seconds
  options.headers['x-goog-api-key'] = apiKey;
  options.signal = controller.signal;
  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: { message: 'Request to upstream provider timed out.' } }), {
        status: 408,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }
}

// --- Main Worker Logic ---
async function processTask(jobId) {
    const redisClient = getRedisClient();
    const jobRedisKey = `${JOB_KEY_PREFIX}${jobId}`;

    try {
        await redisClient.json.set(jobRedisKey, '$.status', 'processing');

        const jobData = await redisClient.json.get(jobRedisKey, '$');
        const task = jobData[0]; // redisjson.get returns an array

        if (!task || !task.originalBody) {
            throw new Error(`Invalid job data for jobId: ${jobId}`);
        }

        const key = await getNextKey();
        if (!key) {
             throw new Error('All API keys are busy or unavailable.');
        }

        const { model: requestedModel, stream } = task.originalBody;
        const geminiRequest = convertToGeminiRequest(task.originalBody);
        const model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

        const response = await fetchWithTimeout(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiRequest),
        }, key);

        if (response.ok) {
            await returnKey(key);
            const result = await response.json();
            await redisClient.json.set(jobRedisKey, '$.status', 'completed');
            await redisClient.json.set(jobRedisKey, '$.result', result);
            await redisClient.json.set(jobRedisKey, '$.completedAt', new Date().toISOString());
        } else {
            // Handle retriable errors by returning the key
            if (response.status === 429 || response.status === 503 || response.status === 500 || response.status === 408) {
                await returnKey(key);
                throw new Error(`Upstream API returned retriable error: ${response.status}`);
            }
            // For permanent errors, the key is not returned ("burned")
            console.warn(`[Worker] Permanently removing key ${key.substring(0,4)}... due to status ${response.status}`);
            throw new Error(`Upstream API returned permanent error: ${response.status}`);
        }
    } catch (error) {
        console.error(`[Worker] Failed to process job ${jobId}:`, error);
        // Mark the job as failed in Redis
        await redisClient.json.set(jobRedisKey, '$.status', 'failed');
        await redisClient.json.set(jobRedisKey, '$.error', error.message);
        await redisClient.json.set(jobRedisKey, '$.completedAt', new Date().toISOString());
    }
}


// --- The Worker Handler ---
export default async function handler(request) {
    // Optional: Secure this endpoint, e.g., by checking a secret header from the cron job.
    // const secret = request.headers.get('Authorization');
    // if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    //   return new Response('Unauthorized', { status: 401 });
    // }

    try {
        const redisClient = getRedisClient();
        const taskJson = await redisClient.rpop(TASK_QUEUE_NAME);

        if (!taskJson) {
            return new Response(JSON.stringify({ message: 'No tasks in queue.' }), { status: 200 });
        }

        const task = JSON.parse(taskJson);
        await processTask(task.jobId);

        return new Response(JSON.stringify({ message: `Successfully processed job ${task.jobId}.` }), { status: 200 });

    } catch (error) {
        console.error('[WorkerHandler] Critical error:', error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}
