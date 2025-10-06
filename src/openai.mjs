// src/openai.mjs (Radical Simplicity Edition)
import { getNextKey, returnKey } from './key_manager.js';

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
  const timeoutId = setTimeout(() => controller.abort(), 8000); // Increased to 8s
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
  const key = await getNextKey();
  if (!key) {
    return new Response(JSON.stringify({ error: { message: 'All API keys are currently in use or the queue is empty.', type: 'no_keys_available' } }), { status: 503 });
  }

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
    // SUCCESS: Return the key to the back of the queue.
    await returnKey(key);
    // Return the successful response to the client.
    return new Response(response.body, { status: response.status, headers: response.headers });
  }

  if (response.status === 429 || response.status === 503 || response.status === 500 || response.status === 408) {
    // TEMPORARY ERROR: The key is probably still good, just "tired".
    // Return it to the back of the queue to give it a rest.
    await returnKey(key);
    // Inform the client to try again later.
    return new Response(JSON.stringify({ error: { message: 'The service is temporarily unavailable, please try again later.', type: 'service_unavailable' } }), { status: 503 });
  }

  // PERMANENT ERROR (400, 401, 403, etc.):
  // The key is bad. We do NOT return it to the queue. It is now permanently removed from rotation.
  console.warn(`[KeyBurn] Permanently removing key ${key.substring(0,4)}... due to status ${response.status}`);
  return new Response(JSON.stringify({ error: { message: 'An unrecoverable error occurred with the API key.', type: 'bad_gateway' } }), { status: 502 });
}
