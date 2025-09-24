import keyManager from './key_manager.js';
import { calculateRetryDelay, adaptiveTimeout, errorTracker } from './utils.js';
import openai from './openai.mjs';

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname.includes("/v1")) {
    return openai.fetch(request, env, keyManager);
  }

  const MAX_RETRIES = 5;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    const apiKey = keyManager.getNextAvailableKey();

    if (!apiKey) {
      throw new Error("All API keys are currently unavailable.");
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
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set('Referrer-Policy', 'no-referrer');
          return new Response(response.body, {
              status: response.status,
              headers: responseHeaders
          });
      }

      const error = new Error(`HTTP error! status: ${response.status}`);
      error.status = response.status;
      throw error;

    } catch (error) {
      errorTracker.trackError(error);

      if (error.status === 429) {
        keyManager.markQuotaExceeded(apiKey.key);
      }

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

