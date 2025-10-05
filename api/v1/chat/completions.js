// Vercel Edge Function - Self-Contained with All Logic
import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

// --- Start of Redis Logic from key_manager.js ---
let redis;

function getRedisClient() {
  if (!redis) {
    console.log('[DIAGNOSTIC-LOG] Initializing Redis Client...');
    console.log(`[DIAGNOSTIC-LOG] UPSTASH_REDIS_REST_URL type: ${typeof process.env.UPSTASH_REDIS_REST_URL}`);
    console.log(`[DIAGNOSTIC-LOG] UPSTASH_REDIS_REST_TOKEN exists: ${!!process.env.UPSTASH_REDIS_REST_TOKEN}`);

    // ROBUSTNESS FIX: Manually trim environment variables to handle data pollution (e.g., trailing newlines) from platforms like Vercel.
    // Direct instantiation is used instead of Redis.fromEnv() to allow for this preprocessing.
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    if (!url || !token) {
        console.error('[DIAGNOSTIC-LOG] FATAL: Missing Redis connection credentials. URL or Token is undefined after trim.');
        // This specific error message is for unified error handling in the main handler.
        throw new Error('Server configuration error: Redis connection credentials are not set in the environment.');
    }

    redis = new Redis({
      url: url,
      token: token,
    });
  }
  return redis;
}

const KEY_PREFIX = 'gemini_key:';

async function getAllKeys() {
  const redisClient = getRedisClient();
  const keys = await redisClient.keys(`${KEY_PREFIX}*`);
  return keys.map(key => key.substring(KEY_PREFIX.length));
}

async function getRandomKey() {
  const redisClient = getRedisClient();
  const allKeyNames = await getAllKeys();
  if (allKeyNames.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * allKeyNames.length);
  const randomKeyName = allKeyNames[randomIndex];

  // --- DEFINITIVE FIX: Defensively handle the retrieved value from Redis to ensure it's a string. ---
  // The root cause of the "Invalid API Key" error was that Redis was returning a JSON object/array
  // which was being implicitly converted to the string "[object Object]" in the request header.
  // This logic inspects the returned value and extracts the key string regardless of the stored data structure.
  const rawValue = await redisClient.get(`${KEY_PREFIX}${randomKeyName}`);

  let apiKey = null;

  if (typeof rawValue === 'string') {
    // Case 1: The value is already a valid string.
    apiKey = rawValue;
  } else if (Array.isArray(rawValue) && rawValue.length > 0 && typeof rawValue[0] === 'string') {
    // Case 2: The value is an array, take the first string element.
    apiKey = rawValue[0];
  } else if (typeof rawValue === 'object' && rawValue !== null && 'key' in rawValue && typeof rawValue.key === 'string') {
    // Case 3: The value is an object like { "key": "..." }, extract the 'key' property.
    apiKey = rawValue.key;
  } else {
    // If the data structure is unknown or invalid, log an error and return null.
    console.error(`[DIAGNOSTIC-LOG] FATAL: Invalid or unexpected API key structure retrieved from Redis for key name '${randomKeyName}'. Value:`, JSON.stringify(rawValue));
    return null;
  }

  // FINAL VALIDATION: Ensure the extracted key is not empty.
  return apiKey ? apiKey.trim() : null;
}
// --- End of Redis Logic ---


// --- Start of Inlined Logic from openai.mjs and dependencies ---



// -----------------------------------------------------------------------------
// Inlined from utils.js (Simplified for self-containment)
class AdaptiveTimeout {
  constructor() { this.timeout = 10000; } // 10 seconds default
  getTimeout() { return this.timeout; }
  increaseTimeout() { this.timeout = Math.min(this.timeout + 2000, 30000); }
  decreaseTimeout() { this.timeout = Math.max(this.timeout - 1000, 5000); }
}

const adaptiveTimeout = new AdaptiveTimeout();
const MAX_RETRIES = 3; // Reduced for faster failure in critical cases

async function fetchWithRetry(url, options, apiKey) {
  let retries = 0;
  let lastError = null;

  while (retries < MAX_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout.getTimeout());

    const finalOptions = {
        ...options,
        headers: {
            ...options.headers,
            'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
    };

    try {
      const response = await fetch(url, finalOptions);
      clearTimeout(timeoutId);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        return response;
      }

      if (response.status >= 400 && response.status < 500) {
          const errorBody = await response.json().catch(() => ({ message: `Client error with status ${response.status}` }));
          lastError = new Error(JSON.stringify(errorBody));
          if (response.status === 429) {
              lastError.name = 'QuotaExceededError';
          }
          break; // Do not retry on client errors
      }

      lastError = new Error(`API request failed with status ${response.status}`);
      // Fallthrough to retry for 5xx errors

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (error.name === 'AbortError') {
        adaptiveTimeout.increaseTimeout();
      }
    }
    retries++;
    await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Simple backoff
  }

  console.error(`Request failed after ${MAX_RETRIES} retries. Last error:`, lastError);
  throw lastError;
}

function convertToGeminiRequest(openaiRequest) {
  const { messages } = openaiRequest;
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  let prompt = '';
  if (lastUserMessage && typeof lastUserMessage.content === 'string') {
    prompt = lastUserMessage.content;
  }
  return {
    contents: [{ parts: [{ text: prompt }] }],
  };
}

const modelMap = new Map([
    ['gemini-2.5-pro', 'gemini-2.5-pro'],
    ['gemini-2.5-flash', 'gemini-2.5-flash'],
    ['gemini-pro', 'gemini-2.5-pro'],
    ['gemini-1.5-flash', 'gemini-2.5-flash'],
]);
// -----------------------------------------------------------------------------

// --- End of Inlined Logic ---


// The main, self-contained handler function
export default async function handler(request) {
  console.log('[DIAGNOSTIC-LOG] --- Step 1: Handler started');
  // --- ARCHITECTURAL FIX: Unified Try/Catch Block ---
  // This single, top-level try/catch block ensures that ANY error,
  // from JSON parsing to business logic execution, is caught and handled gracefully.
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method Not Allowed', type: 'invalid_request_error' } }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }
    console.log('[DIAGNOSTIC-LOG] --- Step 2: Method check passed');

    // 1. Robust JSON Parsing (Text-First Approach)
    let requestBody;
    try {
        console.log('[DIAGNOSTIC-LOG] --- Step 3: Attempting to parse JSON body');
        requestBody = await request.json();
        console.log('[DIAGNOSTIC-LOG] --- Step 4: JSON body parsed successfully');
    } catch (e) {
        // Forward the specific parsing error for precise diagnostics
        throw new SyntaxError(e.message);
    }


    // 3. Request Conversion & Model Mapping
    const { messages, model: requestedModel, stream } = requestBody;
    if (!messages || !Array.isArray(messages)) {
      console.error('[DIAGNOSTIC-LOG] --- FATAL: Invalid request body received. Body:', JSON.stringify(requestBody));
      return new Response(JSON.stringify({ error: { message: "Invalid request body: 'messages' must be an array.", type: 'invalid_request_error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    console.log('[DIAGNOSTIC-LOG] --- Step 5: Converting to Gemini request');
    const geminiRequest = convertToGeminiRequest(requestBody);
    console.log('[DIAGNOSTIC-LOG] --- Step 6: Converted to Gemini request successfully');
    const model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
        const geminiApiBaseUrl = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').trim();
    const geminiApiUrl = `${geminiApiBaseUrl}/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    // 4. Upstream API Call with dynamic key from Redis
    const geminiApiKey = await getRandomKey();
    if (!geminiApiKey) {
        return new Response(JSON.stringify({ error: { message: 'Server configuration error: No available API Keys in Redis.', type: 'server_error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    console.log('[DIAGNOSTIC-LOG] --- Step 7: Preparing to call fetchWithRetry', { geminiApiUrl, geminiRequest: JSON.stringify(geminiRequest) });
    const response = await fetchWithRetry(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    }, geminiApiKey);
    console.log('[DIAGNOSTIC-LOG] --- Step 8: fetchWithRetry call successful');

    // 5. Response Handling
    if (stream) {
        const transformStream = new TransformStream();
        if (response.body) {
          response.body.pipeTo(transformStream.writable);
        } else {
          // Handle cases where the response body is null
          const writer = transformStream.writable.getWriter();
          writer.close();
        }
        return new Response(transformStream.readable, {
            status: response.status,
            headers: response.headers
        });
    } else {
        const responseBody = await response.json();
        return new Response(JSON.stringify(responseBody), {
            status: response.status,
            headers: { ...response.headers, 'Content-Type': 'application/json' }
        });
    }

  } catch (error) {
    console.log('[DIAGNOSTIC-LOG] --- ERROR: Caught an error in the main handler');
    // This is the unified error handler.
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + error.message, type: 'invalid_request_error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (error.name === 'QuotaExceededError') {
        return new Response(JSON.stringify({ error: { message: 'API quota exceeded for the provided key.', type: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    console.error(`[Handler] Critical unhandled error: ${error.message}`, error);
    return new Response(JSON.stringify({ error: { message: `Internal Server Error: ${error.message}`, type: 'internal_error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
