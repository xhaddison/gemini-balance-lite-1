import { AdaptiveTimeout, ErrorTracker, calculateRetryDelay } from './utils.js';
import { getRandomKey } from './key_manager.js';

const adaptiveTimeout = new AdaptiveTimeout();
const errorTracker = new ErrorTracker();

const MAX_RETRIES = 5;

async function fetchWithRetry(url, options) {
  console.log(`[${new Date().toISOString()}] --- fetchWithRetry START ---`);
  console.time(`[${new Date().toISOString()}] fetchWithRetry`);
  let retries = 0;
  let lastError = null;

  while (retries < MAX_RETRIES) {
    const apiKeyObject = await getRandomKey();
    if (!apiKeyObject) {
      console.error('All API keys are unavailable.');
      throw new Error('All API keys are currently unavailable.');
    }
    const currentKey = apiKeyObject.key;

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
        throw new Error(JSON.stringify(errorBody)); // Throw to exit the retry loop immediately.
      }
      // --- END CRITICAL FIX ---

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        console.timeEnd(`[${new Date().toISOString()}] fetchWithRetry`);
        console.log(`[${new Date().toISOString()}] --- fetchWithRetry END (Success) ---`);
        return response;
      }

      if (response.status === 429) {
        console.error(`API quota exceeded for key ${currentKey}. Halting retries.`);
        throw new Error('API quota exceeded. Halting retries.');
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
  console.timeEnd(`[${new Date().toISOString()}] fetchWithRetry`);
  console.log(`[${new Date().toISOString()}] --- fetchWithRetry END (Failure) ---`);
  throw new Error(`Request failed after ${MAX_RETRIES} retries. Last error: ${lastError.message || lastError}`);
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

function getResponse(body, stream) {
  if (!stream || !body.body) {
    return body;
  }
  const sseTransformer = createSSETransformer();
  return new Response(body.body.pipeThrough(sseTransformer), {
    headers: { 'Content-Type': 'text/event-stream' }
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
    ['gemini-pro', 'gemini-pro-latest'],
    ['gemini-1.5-flash', 'gemini-flash-latest'],
    ['gemini-2.5-pro', 'gemini-2.5-pro'],
    ['gemini-2.5-flash', 'gemini-2.5-flash'],
]);

export async function OpenAI(request) {
  console.log(`[${new Date().toISOString()}] --- OpenAI START ---`);
  try {
    const requestBody = await request.json();
    const { messages, model: requestedModel, stream } = requestBody;

    if (!Array.isArray(messages)) {
      console.error("[OpenAI] Invalid request body: 'messages' is not an array.", requestBody);
      throw new Error("Invalid request body: 'messages' must be an array.");
    }

    const geminiRequest = convertToGeminiRequest(requestBody);

    // Dynamic model mapping and fallback logic
    let model;
    if (requestedModel && modelMap.has(requestedModel)) {
      model = modelMap.get(requestedModel);
    } else {
      model = 'gemini-pro-latest'; // CRITICAL FIX: Fallback to a known valid default model.
      if (requestedModel) {
        console.warn(`[OpenAI] Model mapping not found for requested model: '${requestedModel}'. Falling back to '${model}'.`);
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    console.log(`[${new Date().toISOString()}] [OpenAI] Forwarding request to model: ${model}, URL: ${url}`);
    console.log(`[${new Date().toISOString()}] [OpenAI] About to call fetchWithRetry.`);
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    });
    console.log(`[${new Date().toISOString()}] [OpenAI] fetchWithRetry completed.`);

    return getResponse(response, stream);

  } catch (error) {
    console.error(`[OpenAI] Critical error in main function: ${error.message}`, {
      error,
      requestHeaders: request.headers,
    });
    return new Response(JSON.stringify({ error: { message: `Internal Server Error: ${error.message}`, type: 'internal_error' } }), { status: 500 });
  }
}
