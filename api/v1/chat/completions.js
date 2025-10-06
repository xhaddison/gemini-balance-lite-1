// Vercel Edge Function - Radically Simple, Self-Contained, High-Performance Edition
import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

// --- Start of Inlined, Radically Simple key_manager.js Logic ---
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

const KEYS_QUEUE_NAME = 'keys_queue';

async function getNextKey() {
  try {
    return await getRedisClient().lpop(KEYS_QUEUE_NAME);
  } catch (error) {
    console.error('[KeyManager] Failed to get next key from Redis:', error);
    return null;
  }
}

async function returnKey(key) {
  if (typeof key !== 'string' || !key) return;
  try {
    await getRedisClient().rpush(KEYS_QUEUE_NAME, key);
  } catch (error) {
    console.error(`[KeyManager] Failed to return key ${key.substring(0,4)}... to Redis:`, error);
  }
}
// --- End of Inlined Key Manager Logic ---


// --- Start of Inlined, Radically Simple openai.mjs Logic ---
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
  // Vercel's hobby tier has a 10s timeout, so we must be aggressive. 5s is a safe bet.
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  options.headers['x-goog-api-key'] = apiKey;
  options.signal = controller.signal;
  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { status: 408, statusText: 'Request Timeout' };
    }
    throw error;
  }
}
// --- End of Inlined OpenAI Logic ---


// --- The Main, Self-Contained Handler ---
export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), { status: 405 });
  }

  const key = await getNextKey();
  if (!key) {
    return new Response(JSON.stringify({ error: { message: 'All API keys are busy or unavailable.', type: 'no_keys_available' } }), { status: 503 });
  }

  try {
    const requestBody = await request.json();
    const { model: requestedModel, stream } = requestBody;
    const geminiRequest = convertToGeminiRequest(requestBody);
    const model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    const response = await fetchWithTimeout(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    }, key);

    // --- Radically Simple Key Handling ---
    if (response.ok) {
      await returnKey(key); // Return good key to the back of the queue
      return new Response(response.body, { status: response.status, headers: response.headers });
    }

    if (response.status === 429 || response.status === 503 || response.status === 500 || response.status === 408) {
      await returnKey(key); // Return "tired" key to the back for a rest
      return new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable, please try again.', type: 'service_unavailable' } }), { status: 503 });
    }

    // PERMANENT ERROR (400, 401, etc.): Do NOT return the key. It's burned.
    console.warn(`[KeyBurn] Permanently removing key ${key.substring(0,4)}... due to status ${response.status}`);
    return new Response(JSON.stringify({ error: { message: 'An unrecoverable error occurred.', type: 'bad_gateway' } }), { status: 502 });

  } catch (error) {
    // This catches JSON parsing errors or unexpected fetch errors
    if (error instanceof SyntaxError) {
         return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + error.message, type: 'invalid_request_error' } }), { status: 400 });
    }
    console.error('[Handler] Critical unhandled error:', error);
    // Do NOT return the key if a critical error occurred, as its state is unknown.
    return new Response(JSON.stringify({ error: { message: 'Internal Server Error.', type: 'internal_error' } }), { status: 500 });
  }
}
