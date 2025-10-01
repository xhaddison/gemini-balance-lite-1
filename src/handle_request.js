import { getRandomKey, getAllKeys, addKey, deleteKey, verifyAdminKey } from './key_manager.js';
import { calculateRetryDelay, AdaptiveTimeout, errorTracker, MAX_RETRIES } from './utils.js';
const adaptiveTimeout = new AdaptiveTimeout();
import { OpenAI } from './openai.mjs';

const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

export async function handleRequest(request, ctx) {
  console.log('Received headers:', JSON.stringify(Object.fromEntries(request.headers.entries())));
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/keys')) {
    // Directly handle the API logic here
    if (!verifyAdminKey(request)) {
      return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
    }

    try {
      switch (request.method) {
        case 'GET': {
          const keys = await getAllKeys();
          return jsonResponse({ success: true, keys });
        }

        case 'POST': {
          const { key: newKey } = await request.json();
          if (!newKey) {
            return jsonResponse({ success: false, message: 'Bad Request: "key" is required.' }, 400);
          }
          const addResult = await addKey(newKey);
          return jsonResponse(addResult, addResult.success ? 201 : 400);
        }

        case 'DELETE': {
          const { key: keyToDelete } = await request.json();
          if (!keyToDelete) {
            return jsonResponse({ success: false, message: 'Bad Request: "key" is required.' }, 400);
          }
          const deleteResult = await deleteKey(keyToDelete);
          return jsonResponse(deleteResult, deleteResult.success ? 200 : 404);
        }

        default:
          return new Response(`Method ${request.method} Not Allowed`, {
            status: 405,
            headers: { 'Allow': 'GET, POST, DELETE' },
          });
      }
    } catch (error) {
       console.error(`[API /api/keys] Error during ${request.method} request:`, error);
      if (error instanceof SyntaxError) {
        return jsonResponse({ success: false, message: 'Invalid JSON body.' }, 400);
      }
      return jsonResponse({ success: false, message: 'Internal Server Error' }, 500);
    }
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
