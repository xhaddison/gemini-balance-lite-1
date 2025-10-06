import { AdaptiveTimeout, ErrorTracker, calculateRetryDelay } from './utils.js';
import { getRandomKey, getAllKeys, validateKey } from './key_manager.js';

const adaptiveTimeout = new AdaptiveTimeout();
const errorTracker = new ErrorTracker();

const MAX_RETRIES = 5;

async function fetchWithRetry(url, options, apiKey) {
  const timerLabel = `[${new Date().toISOString()}] fetchWithRetry`;
  console.log(`[${new Date().toISOString()}] --- fetchWithRetry START ---`);
  console.time(timerLabel);
  let retries = 0;
  let lastError = null;

  try {
    while (retries < MAX_RETRIES) {
      const currentKey = apiKey;

      // --- CRITICAL FIX START ---
      // Ensure the API key is NOT in the query parameters.
      const urlObject = new URL(url);
      if (urlObject.searchParams.has('key')) {
        console.warn('[fetchWithRetry] Removing API key from query parameter to enforce header-only authentication.');
        urlObject.searchParams.delete('key');
      }
      const finalUrl = urlObject.toString();
      // --- CRITICAL FIX END ---

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout.getTimeout());

      // Correctly set header for Google Gemini API and remove incorrect one
      delete options.headers['Authorization'];
      options.headers['x-goog-api-key'] = currentKey;
      options.signal = controller.signal;

      try {
        console.log(`[${new Date().toISOString()}] [fetchWithRetry] Attempt #${retries + 1} to fetch URL: ${finalUrl}`);
        console.log(`[${new Date().toISOString()}] [fetchWithRetry] Using API Key starting with: ${currentKey.substring(0, 8)}...`);
        console.log(`[${new Date().toISOString()}] [fetchWithRetry] About to call fetch.`);
        const response = await fetch(finalUrl, options);
        console.log(`[${new Date().toISOString()}] [fetchWithRetry] fetch completed with status: ${response.status}`);
        clearTimeout(timeoutId);

        // --- CRITICAL FIX: Abort on any 4xx client error ---
        if (response.status >= 400 && response.status < 500) {
          const errorBody = await response.json().catch(() => ({ message: `Client error with status ${response.status}` }));
          console.error(`[fetchWithRetry] Client error (${response.status}) received. Halting retries.`, errorBody);
          // For quota issues with a user-provided key, we throw a specific, catchable error.
          if (response.status === 429) {
              const specificError = new Error(JSON.stringify(errorBody));
              specificError.name = 'QuotaExceededError';
              throw specificError;
          }
          throw new Error(JSON.stringify(errorBody)); // Throw to exit the retry loop immediately.
        }
        // --- END CRITICAL FIX ---

        if (response.ok) {
          adaptiveTimeout.decreaseTimeout();
          console.log(`[${new Date().toISOString()}] --- fetchWithRetry END (Success) ---`);

          // CRITICAL FIX: Instead of creating a new Response, return the original response
          // to let the caller handle the stream lifecycle.
          return response;
        }

        if (response.status === 429) {
          console.error(`API quota exceeded for key ${currentKey}. Halting retries.`);
          const specificError = new Error('API quota exceeded. Halting retries.');
          specificError.name = 'QuotaExceededError';
          throw specificError;
        }

        const errorData = await response.json().catch(() => ({ status: response.status, message: response.statusText }));
        errorData.status = response.status;
        lastError = errorData;

        errorTracker.trackError(errorData, currentKey);

        const delay = calculateRetryDelay(errorData, retries);
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        retries++;

      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        errorTracker.trackError(error, currentKey);

        // If it's a quota error, we must not retry. Re-throw to be caught by the main handler.
        if (error.name === 'QuotaExceededError') {
            throw error;
        }

        if (error.name === 'AbortError') {
          console.error(`Request timed out with key ${currentKey}. Increasing timeout.`);
          adaptiveTimeout.increaseTimeout();
        }

        const delay = calculateRetryDelay(error, retries);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }

    console.error(`Request failed after ${MAX_RETRIES} retries. Last error:`, lastError);
    throw new Error(`Request failed after ${MAX_RETRIES} retries. Last error: ${lastError.message || lastError}`);
  } finally {
    console.timeEnd(timerLabel);
    console.log(`[${new Date().toISOString()}] --- fetchWithRetry FINALIZED ---`);
  }
}

function createSSETransformer() {
  let buffer = '';
  return new TransformStream({
    transform(chunk, controller) {
      buffer += new TextDecoder().decode(chunk);
      let eolIndex;
      while ((eolIndex = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, eolIndex).trim();
        buffer = buffer.slice(eolIndex + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            controller.terminate();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(new TextEncoder().encode(content));
            }
          } catch (e) {
            console.error('Error parsing SSE chunk:', e);
          }
        }
      }
    }
  });
}


function convertToGeminiRequest(openaiRequest) {
  const { model, messages, stream } = openaiRequest;

  // For simplicity, we'll take the content from the last user message as the prompt.
  // A more robust solution would handle multi-turn conversations.
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  let prompt = '';
  if (lastUserMessage) {
    if (typeof lastUserMessage.content === 'string') {
      prompt = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage.content) && lastUserMessage.content[0] && typeof lastUserMessage.content[0].text === 'string') { // Check for array of parts
      prompt = lastUserMessage.content[0].text;
    } else if (Array.isArray(lastUserMessage.parts) && lastUserMessage.parts[0] && typeof lastUserMessage.parts[0].text === 'string') {
      prompt = lastUserMessage.parts[0].text;
    }
  }

  return {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    // Note: Gemini API has different parameters for streaming, safety settings, etc.
    // This is a simplified conversion.
  };
}

const modelMap = new Map([
    // DEFINITIVE MAPPING based on authoritative ListModels API call
    ['gemini-2.5-pro', 'gemini-2.5-pro'],
    ['gemini-2.5-flash', 'gemini-2.5-flash'],
    // Fallback for older models for maximum compatibility
    ['gemini-pro', 'gemini-2.5-pro'],
    ['gemini-1.5-flash', 'gemini-2.5-flash'],
]);


export async function OpenAI(request, ctx, requestBody) {

  console.log(`[${new Date().toISOString()}] --- OpenAI START ---`);
  try {
    // --- AUTHORIZATION FIX START ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: { message: 'Authorization header is missing or invalid.', type: 'authentication_error' } }), { status: 401 });
    }
    const clientKey = authHeader.substring(7);

    const isKeyValid = await validateKey(clientKey);
    if (!isKeyValid) {
        return new Response(JSON.stringify({ error: { message: 'Invalid API Key.', type: 'authentication_error' } }), { status: 401 });
    }
    // --- AUTHORIZATION FIX END ---


    const { messages, model: requestedModel, stream } = requestBody;

    if (!messages || !Array.isArray(messages)) {
      console.error("[OpenAI] Invalid request body: 'messages' is missing or not an array.", requestBody);
      return new Response(JSON.stringify({ error: { message: "Invalid request body: 'messages' must be an array.", type: 'invalid_request_error' } }), { status: 400 });
    }

    const geminiRequest = convertToGeminiRequest(requestBody);

    // Dynamic model mapping and fallback logic
    let model;
    if (requestedModel && modelMap.has(requestedModel)) {
      model = modelMap.get(requestedModel);
    } else {
      model = 'gemini-2.5-pro'; // CRITICAL FIX: Fallback to a known valid default model based on ListModels API.
      if (requestedModel) {
        console.warn(`[OpenAI] Model mapping not found for requested model: '${requestedModel}'. Falling back to '${model}'.`);
      }
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    console.log(`[${new Date().toISOString()}] [OpenAI] Forwarding request to model: ${model}, URL: ${geminiApiUrl}`);
    console.log(`[${new Date().toISOString()}] [OpenAI] About to call fetchWithRetry.`);
    const response = await fetchWithRetry(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    }, clientKey); // Pass the validated client key
    console.log(`[${new Date().toISOString()}] [OpenAI] fetchWithRetry completed.`);

    // --- RESPONSE HANDLING ---
    console.log(`[${new Date().toISOString()}] [OpenAI] Response received. Handling stream: ${stream}`);
    if (stream) {
        // For streaming responses, we need to decouple the streams.
        // We pipe the original response body through a new TransformStream.
        // This creates a new stream that is fully controlled by our application,
        // preventing the 'terminatedTypeError' that occurs when the original
        // fetch connection is closed prematurely by the environment.
        const transformStream = new TransformStream();
        response.body.pipeTo(transformStream.writable);

        return new Response(transformStream.readable, {
            status: response.status,
            headers: response.headers
        });
    } else {
        // For non-streaming, we can safely buffer the entire response.
        const responseBody = await response.json();
        return new Response(JSON.stringify(responseBody), {
            status: response.status,
            headers: {
                ...response.headers,
                'Content-Type': 'application/json'
            }
        });
    }
    // --- END RESPONSE HANDLING ---

  } catch (error) {
     // --- AUTHORIZATION: Specific error handling for quota ---
     if (error.name === 'QuotaExceededError') {
        return new Response(JSON.stringify({ error: { message: 'API quota exceeded for the provided key.', type: 'insufficient_quota' } }), { status: 429 });
    }
    // --- END AUTHORIZATION ---
    console.error(`[OpenAI] Critical error in main function: ${error.message}`, {
      error,
      requestHeaders: request.headers,
    });
    return new Response(JSON.stringify({ error: { message: `Internal Server Error: ${error.message}`, type: 'internal_error' } }), { status: 500 });
  }
}
