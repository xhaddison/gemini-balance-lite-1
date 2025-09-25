import { getKeyManager } from './key_manager.js';
import { calculateRetryDelay, AdaptiveTimeout, errorTracker, MAX_RETRIES } from './utils.js';
const adaptiveTimeout = new AdaptiveTimeout();
import { OpenAI } from './openai.mjs';

export async function handleRequest(request, env) {
  const keyManager = await getKeyManager();
  const url = new URL(request.url);

  if (url.pathname.startsWith('/v1/')) {
    return OpenAI(request, env);
  }

  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    const apiKey = await keyManager.getKey();

    if (!apiKey) {
      break;
    }

    const pathname = url.pathname;
    const search = url.search;
    const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

    const headers = new Headers(request.headers);
    headers.set('x-goog-api-key', apiKey.key);

    try {
      const controller = new AbortController();
      const timeout = adaptiveTimeout.getTimeout();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        keyManager.updateKeyStatus(apiKey, 200);
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set('Referrer-Policy', 'no-referrer');
          return new Response(response.body, {
              status: response.status,
              headers: responseHeaders
          });
      }

      const errorData = await response.json().catch(() => ({ status: response.status, message: response.statusText }));
      errorData.status = response.status;

      errorTracker.trackError(errorData, apiKey.key);

      if (response.status === 429) {
        keyManager.updateKeyStatus(apiKey, 429);
      } else if (response.status >= 500) {
        keyManager.updateKeyStatus(apiKey, 500);
      }


    } catch (error) {
      keyManager.updateKeyStatus(apiKey, 500); // Assuming server error for catch block
      errorTracker.trackError(error);

      if (error.name === 'AbortError' || error.status === 504) {
        adaptiveTimeout.increaseTimeout();
      }

      await new Promise(resolve => setTimeout(resolve, calculateRetryDelay(error, attempts)));
      attempts++;
    }
  }

  // If the loop finishes, all retries have failed.
  return new Response('The request failed after multiple retries.', {
    status: 502,
  });
}

