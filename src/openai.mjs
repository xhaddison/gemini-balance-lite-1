import { AdaptiveTimeout, ErrorTracker, calculateRetryDelay } from './utils.js';
import { getRandomKey } from './key_manager.js';

const adaptiveTimeout = new AdaptiveTimeout();
const errorTracker = new ErrorTracker();

let keyManager;

async function initializeKeyManager() {
  if (!keyManager) {
    keyManager = await getRandomKey();
  }
}

const MAX_RETRIES = 5;

async function fetchWithRetry(url, options) {
  await initializeKeyManager();
  let retries = 0;
  let lastError = null;

  while (retries < MAX_RETRIES) {
    const apiKey = await keyManager.getKey();
    if (!apiKey) {
      console.error('All API keys are unavailable.');
      throw new Error('All API keys are currently unavailable.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout.getTimeout());

    options.headers['Authorization'] = `Bearer ${apiKey}`;
    options.signal = controller.signal;

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      await keyManager.updateKeyStatus(apiKey, response.status);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        return response;
      }

      const errorData = await response.json().catch(() => ({ status: response.status, message: response.statusText }));
      errorData.status = response.status;
      lastError = errorData;

      errorTracker.trackError(errorData, apiKey);

      const delay = calculateRetryDelay(errorData, retries);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      errorTracker.trackError(error, apiKey);
      await keyManager.updateKeyStatus(apiKey, 500); // Generic error code for catch block

      if (error.name === 'AbortError') {
        console.error(`Request timed out with key ${apiKey}. Increasing timeout.`);
        adaptiveTimeout.increaseTimeout();
      }

      const delay = calculateRetryDelay(error, retries);
      await new Promise(resolve => setTimeout(resolve, delay));
      retries++;
    }
  }

  console.error(`Request failed after ${MAX_RETRIES} retries. Last error:`, lastError);
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

export async function OpenAI(request) {
  const { model, messages, stream } = request;
  const url = 'https://api.openai.com/v1/chat/completions';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
    }),
  };

  try {
    const response = await fetchWithRetry(url, options);

    if (!stream) {
      return response.json();
    } else {
      return getResponse(response, true);
    }
  } catch (error) {
    console.error('OpenAI API request failed definitively:', error);
    if (stream) {
        const errorStream = new ReadableStream({
        start(controller) {
          const errorData = JSON.stringify({ error: { message: error.message, type: 'internal_error' } });
          controller.enqueue(new TextEncoder().encode(`data: ${errorData}\\n\\n`));
          controller.close();
        }
      });
      return new Response(errorStream, { status: 500, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ error: { message: error.message, type: 'internal_error' } }), { status: 500 });
  }
}
