import { AdaptiveTimeout, ErrorTracker, calculateRetryDelay } from './utils.js';
import { getRandomKey } from './key_manager.js';

const adaptiveTimeout = new AdaptiveTimeout();
const errorTracker = new ErrorTracker();

const MAX_RETRIES = 5;

async function fetchWithRetry(url, options) {
  let retries = 0;
  let lastError = null;

  while (retries < MAX_RETRIES) {
    const apiKeyObject = await getRandomKey();
    if (!apiKeyObject) {
      console.error('All API keys are unavailable.');
      throw new Error('All API keys are currently unavailable.');
    }
    const currentKey = apiKeyObject.key;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), adaptiveTimeout.getTimeout());

    // Correctly set header for Google Gemini API and remove incorrect one
    delete options.headers['Authorization'];
    options.headers['x-goog-api-key'] = currentKey;
    options.signal = controller.signal;

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
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
  const prompt = lastUserMessage ? lastUserMessage.content : '';

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

export async function OpenAI(request) {
  const geminiRequest = convertToGeminiRequest(request);

  // We need to adjust the URL based on the model and whether we are streaming.
  // Using a simplified, non-streaming model endpoint for now.
  const model = "gemini-pro"; // Or derive from request if needed
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The API key is now added in fetchWithRetry, so we don't set it here.
    },
    body: JSON.stringify(geminiRequest),
  };

  try {
    const response = await fetchWithRetry(url, options);

    // The response from Gemini is different from OpenAI, so we need to transform it back.
    // This is a placeholder for the transformation logic. For now, we return the raw response.
    return response.json();

  } catch (error) {
    console.error('Gemini API request failed definitively:', error);
    return new Response(JSON.stringify({ error: { message: error.message, type: 'internal_error' } }), { status: 500 });
  }
}
