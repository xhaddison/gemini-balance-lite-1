import { AdaptiveTimeout, ErrorTracker, calculateRetryDelay } from './utils.js';
import { keyManager } from './key_manager.js';
import { Readable } from 'stream';

const adaptiveTimeout = new AdaptiveTimeout();
const errorTracker = new ErrorTracker();



const MAX_RETRIES = 5;

async function fetchWithRetry(url, options) {
  let retries = 0;
  let lastError = null;

  while (retries < MAX_RETRIES) {
    const apiKey = keyManager.getNextAvailableKey();
    if (!apiKey) {
      console.error('All API keys are unavailable.');
      throw new Error('All API keys are currently unavailable.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout.getTimeout());

    options.headers['Authorization'] = `Bearer ${apiKey.key}`;
    options.signal = controller.signal;

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        keyManager.markSuccess(apiKey.key);
        return response;
      }

      const errorData = await response.json().catch(() => ({ status: response.status, message: response.statusText }));
      errorData.status = response.status;
      lastError = errorData;

      errorTracker.trackError(errorData, apiKey.key);

      if (response.status === 429) {
        keyManager.markQuotaExceeded(apiKey.key);
      } else if (response.status >= 500) {
        keyManager.markServerError(apiKey.key);
      }

      const delay = calculateRetryDelay(errorData, retries);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      errorTracker.trackError(error, apiKey.key);
      keyManager.markServerError(apiKey.key);

      if (error.name === 'AbortError') {
        console.error(`Request timed out with key ${apiKey.key}. Increasing timeout.`);
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

async function* streamSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          yield buffer;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let eolIndex;
      while ((eolIndex = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, eolIndex);
        buffer = buffer.slice(eolIndex + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function getResponse(body, stream) {
  if (!stream) {
    return body;
  }

  const streamSource = async function* () {
    for await (const chunk of streamSSE(body)) {
      if (chunk === '[DONE]') {
        return;
      }
      try {
        const data = JSON.parse(chunk);
        const content = data.choices[0]?.delta?.content || '';
        if (content) {
          yield content;
        }
      } catch (e) {
        console.error('Error parsing SSE chunk:', e);
      }
    }
  };

  return Readable.from(streamSource());
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
      const jsonResponse = await response.json();
      return getResponse(jsonResponse, false);
    } else {
      return getResponse(response, true);
    }
  } catch (error) {
    console.error('OpenAI API request failed definitively:', error);
    // In stream mode, we need to return a readable stream that emits an error.
    if (stream) {
      const errorStream = new Readable({
        read() {
          this.emit('error', error);
          this.push(null);
        }
      });
      return errorStream;
    }
    // For non-stream mode, re-throw to be caught by the caller.
    throw error;
  }
}
