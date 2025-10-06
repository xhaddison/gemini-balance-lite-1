import fetch from 'node-fetch';
import { getAvailableKeys, putKeyInCooldown, invalidateKey } from './key_manager.js';

function convertToGeminiRequest(openaiRequest) {
  const { model, messages, stream } = openaiRequest;
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  let prompt = '';
  if (lastUserMessage) {
    if (typeof lastUserMessage.content === 'string') {
      prompt = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage.content) && lastUserMessage.content[0] && typeof lastUserMessage.content[0].text === 'string') {
      prompt = lastUserMessage.content[0].text;
    }
  }
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

export async function OpenAI(request, ctx, requestBody) {
  console.log(`[${new Date().toISOString()}] --- OpenAI START ---`);
  const availableKeys = await getAvailableKeys();
  if (availableKeys.length === 0) {
    return new Response(JSON.stringify({ error: { message: 'No available API keys to process the request.', type: 'no_keys_available' } }), { status: 503 });
  }

  const { messages, model: requestedModel, stream } = requestBody;
  const geminiRequest = convertToGeminiRequest(requestBody);
  let model = modelMap.get(requestedModel) || 'gemini-2.5-pro';
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent' : 'generateContent'}`;
  let lastError = null;

  for (const key of availableKeys) {
    try {
      const response = await fetchWithTimeout(geminiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequest),
      }, key);

      if (response.ok) {
        // Handle successful streaming and non-streaming responses
        if (stream) {
            const transformStream = new TransformStream();
            response.body.pipeTo(transformStream.writable);
            return new Response(transformStream.readable, { status: response.status, headers: response.headers });
        } else {
            const responseBody = await response.json();
            return new Response(JSON.stringify(responseBody), { status: response.status, headers: { ...response.headers, 'Content-Type': 'application/json' }});
        }
      }

      const retryAfterHeader = response.headers?.get('Retry-After');
      if (response.status === 429 || response.status === 503) {
        await putKeyInCooldown(key, retryAfterHeader);
        lastError = { status: response.status, key: key.substring(0,4) };
        continue;
      }
      if (response.status === 500) {
        await putKeyInCooldown(key, null, 60);
        lastError = { status: response.status, key: key.substring(0,4) };
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
         await invalidateKey(key);
         lastError = { status: response.status, key: key.substring(0,4) };
         continue;
      }
      if (response.status === 408) {
          lastError = { status: response.status, key: key.substring(0,4) };
          continue;
      }

    } catch (error) {
      console.error(`[OpenAI] Critical error for key ${key.substring(0,4)}...`, error);
      lastError = { status: 500, message: error.message, key: key.substring(0,4) };
      continue;
    }
  }

  return new Response(JSON.stringify({ error: { message: 'All available API keys failed.', type: 'all_keys_failed', last_error: lastError } }), { status: 502 });
}
