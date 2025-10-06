import { ErrorTracker, calculateRetryDelay } from './utils.js';
import { getAllKeys, validateKey } from './key_manager.js';

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

      const urlObject = new URL(url);
      if (urlObject.searchParams.has('key')) {
        console.warn('[fetchWithRetry] Removing API key from query parameter to enforce header-only authentication.');
        urlObject.searchParams.delete('key');
      }
      const finalUrl = urlObject.toString();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      delete options.headers['Authorization'];
      options.headers['x-goog-api-key'] = currentKey;
      options.signal = controller.signal;

      try {
        console.log(`[GEMINI_FETCH_DIAG] --- Calling fetch for URL: ${finalUrl} with key starting ${currentKey.substring(0, 8)}`);
        const response = await fetch(finalUrl, options);
        console.log(`[GEMINI_FETCH_DIAG] --- fetch call completed. Status: ${response.status}`);
        clearTimeout(timeoutId);

        if (response.status >= 400 && response.status < 500) {
          const errorBody = await response.json().catch(() => ({ message: `Client error with status ${response.status}` }));
          console.error(`[fetchWithRetry] Client error (${response.status}) received. Halting retries.`, errorBody);
          if (response.status === 429) {
              const specificError = new Error(JSON.stringify(errorBody));
              specificError.name = 'QuotaExceededError';
              throw specificError;
          }
          throw new Error(JSON.stringify(errorBody));
        }

        if (response.ok) {
          return response;
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

        if (error.name === 'QuotaExceededError') {
            throw error;
        }

        if (error.name === 'AbortError') {
          console.error(`[GEMINI_FETCH_DIAG] --- fetch call ABORTED (timeout) for key ${currentKey.substring(0, 8)}.`);
        }

        const delay = calculateRetryDelay(error, retries);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }
    throw new Error(`Request failed after ${MAX_RETRIES} retries. Last error: ${lastError.message || lastError}`);
  } finally {
    console.timeEnd(timerLabel);
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
  const { messages } = openaiRequest;
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  let prompt = '';
  if (lastUserMessage) {
    if (typeof lastUserMessage.content === 'string') {
      prompt = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage.content) && lastUserMessage.content[0] && typeof lastUserMessage.content[0].text === 'string') {
      prompt = lastUserMessage.content[0].text;
    }
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

export async function OpenAI(request, ctx) {
  try {
    const requestBody = await request.json();
    const { model: requestedModel, stream } = requestBody;

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: { message: 'Authorization header is missing or invalid.', type: 'authentication_error' } }), { status: 401 });
    }
    const userKey = authHeader.substring(7);
    const isUserKeyValid = await validateKey(userKey);
    if (!isUserKeyValid) {
      return new Response(JSON.stringify({ error: { message: 'Invalid API key provided.', type: 'authentication_error' } }), { status: 401 });
    }

    const allKeys = await getAllKeys();
    function shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    }
    shuffle(allKeys);

    const geminiRequest = convertToGeminiRequest(requestBody);

    let model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
    if (!modelMap.has(requestedModel)) {
      console.warn(`[OpenAI] Model mapping not found for requested model: '${requestedModel}'. Falling back to '${model}'.`);
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;

    let response;
    let lastError = null;

    for (const key of allKeys) {
      try {
        console.log(`[GEMINI_FETCH_DIAG] --- Attempting key: ${key.substring(0, 8)}...`);
        response = await fetchWithRetry(geminiApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiRequest),
        }, key);
        console.log(`[GEMINI_FETCH_DIAG] --- Key ${key.substring(0, 8)}... SUCCEEDED.`);
        break;
      } catch (error) {
        lastError = error;
        console.error(`[GEMINI_FETCH_DIAG] --- Key ${key.substring(0, 8)}... FAILED. Error: ${error.message}`);
        if (error.name === 'QuotaExceededError') {
          continue;
        }
      }
    }

    if (!response) {
      throw new Error(`All available API keys failed. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
    }

    if (stream) {
        const transformStream = new TransformStream();
        response.body.pipeTo(transformStream.writable);
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
     if (error.name === 'QuotaExceededError') {
        return new Response(JSON.stringify({ error: { message: 'API quota exceeded for the provided key.', type: 'insufficient_quota' } }), { status: 429 });
    }
    console.error(`[OpenAI] Critical error in main function: ${error.message}`);
    return new Response(JSON.stringify({ error: { message: `Internal Server Error: ${error.message}`, type: 'internal_error' } }), { status: 500 });
  }
}
