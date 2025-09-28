import { getRandomKey, getAllKeys, addKey, deleteKey } from './key_manager.js';
import keyApiHandler from '../api/keys.js';
import { calculateRetryDelay, AdaptiveTimeout, errorTracker, MAX_RETRIES } from './utils.js';
const adaptiveTimeout = new AdaptiveTimeout();
import { OpenAI } from './openai.mjs';

export async function handleRequest(request, ctx) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/keys')) {
    return keyApiHandler.fetch(request, ctx);
  }

  if (url.pathname.startsWith('/v1/')) {
    return OpenAI(request);
  }

  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    const apiKeyObject = await getRandomKey();

    if (!apiKeyObject) {
      break;
    }

    const pathname = url.pathname;
    const search = url.search;
    const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

    const headers = new Headers(request.headers);
    headers.set('x-goog-api-key', apiKeyObject.key);

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
        // Key status is not managed in this simplified version.
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Referrer-Policy', 'no-referrer');
        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders
        });
      }

      const errorData = await response.json().catch(() => ({ status: response.status, message: response.statusText }));
      errorData.status = response.status;

      errorTracker.trackError(errorData, apiKeyObject.key);

    } catch (error) {
      errorTracker.trackError(error, apiKeyObject.key);

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
