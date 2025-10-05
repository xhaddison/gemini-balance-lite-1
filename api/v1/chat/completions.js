// Vercel Edge Function - Self-Contained with All Logic

export const config = {
  runtime: 'edge',
};

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

  // --- ARCHITECTURAL FIX: Unified Try/Catch Block ---
  // This single, top-level try/catch block ensures that ANY error,
  // from JSON parsing to business logic execution, is caught and handled gracefully.
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method Not Allowed', type: 'invalid_request_error' } }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    // 1. Robust JSON Parsing (Text-First Approach)
    let requestBody;
    try {
        requestBody = await request.json();
    } catch (e) {
        // Forward the specific parsing error for precise diagnostics
        throw new SyntaxError(e.message);
    }


    // 3. Request Conversion & Model Mapping
    const { messages, model: requestedModel, stream } = requestBody;
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: { message: "Invalid request body: 'messages' must be an array.", type: 'invalid_request_error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const geminiRequest = convertToGeminiRequest(requestBody);
    const model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
    const geminiApiUrl = `https://generativelenlanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    // 4. Upstream API Call with a single, reliable environment variable
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        return new Response(JSON.stringify({ error: { message: 'Server configuration error: Missing Gemini API Key.', type: 'server_error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const response = await fetchWithRetry(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    }, geminiApiKey);

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
