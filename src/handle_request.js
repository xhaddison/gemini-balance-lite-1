import { getRandomKey, getAllKeys, addKey, deleteKey, verifyAdminKey, addKeysBulk } from './key_manager.js';
import { calculateRetryDelay, AdaptiveTimeout, errorTracker, MAX_RETRIES } from './utils.js';
const adaptiveTimeout = new AdaptiveTimeout();
import { OpenAI } from './openai.mjs';

const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

// --- START: Refactored API Route Handlers ---

async function handleAdminRequest(request) {
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

async function handleBulkUploadRequest(request) {
    if (!verifyAdminKey(request)) {
        return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
    }

    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'POST' } });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('keyFile');

        if (!file) {
            return jsonResponse({ success: false, message: 'Bad Request: "keyFile" is required.' }, 400);
        }

        const text = await file.text();
        const keys = text.split('\n').filter(k => k.trim() !== '');

        if (keys.length === 0) {
            return jsonResponse({
                success: true, total_keys_in_file: 0, successfully_added: 0, failed_entries: [],
                message: 'The uploaded file is empty or contains no valid keys.'
            });
        }

        const bulkResult = await addKeysBulk(keys);
        return jsonResponse({ ...bulkResult, total_keys_in_file: keys.length }, bulkResult.success ? 200 : 500);

    } catch (error) {
        console.error('[API /api/keys/bulk-upload] Error:', error);
        // This can happen if the body is not multipart/form-data
        return jsonResponse({ success: false, message: 'Failed to parse form data. Is the request correct?' }, 400);
    }
}


// --- END: Refactored API Route Handlers ---


export async function handleRequest(request, ctx) {
  console.log(`[${new Date().toISOString()}] --- handleRequest START ---`);
  console.log(`[${new Date().toISOString()}] Received headers:`, JSON.stringify(Object.fromEntries(request.headers.entries())));
  const url = new URL(request.url);

  // --- START: Main Router ---
  if (url.pathname === '/api/keys/bulk-upload') {
    return handleBulkUploadRequest(request);
  }

  if (url.pathname.startsWith('/api/keys')) {
    return handleAdminRequest(request);
  }

  if (url.pathname === '/api/query' || url.pathname.startsWith('/v1/')) {
    try {
      console.log(`[${new Date().toISOString()}] Routing to OpenAI module for path: ${url.pathname}`);
      const response = await OpenAI(request);
      console.log(`[${new Date().toISOString()}] OpenAI module finished processing for path: ${url.pathname}`);
      return response;
    } catch (error) {
      console.error(`[handleRequest] Unhandled exception from OpenAI module: ${error.message}`, {
        error,
        pathname: url.pathname,
      });
      return jsonResponse({
        success: false,
        message: 'An unexpected error occurred while processing the request in the OpenAI module.'
      }, 500);
    }
  }
  // --- END: Main Router ---

  if (url.pathname === '/') {
    return jsonResponse({
      success: true,
      message: 'API is running. See documentation for valid endpoints.'
    });
  }

  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    // Moved request.json() inside the loop to avoid parsing body for all requests.
    const requestBody = await request.json().catch(err => {
        console.error("Failed to parse request body as JSON.", err);
        return null; // Return null if parsing fails
    });

    if (requestBody === null) {
      return jsonResponse({
        success: false,
        message: 'Invalid JSON request body.'
      }, 400);
    }
    const apiKeyObject = await getRandomKey();

    if (!apiKeyObject) {
      console.error("CRITICAL: No API keys available in the key pool. Halting request processing.");
      return jsonResponse({
        success: false,
        message: 'The service is currently unavailable as there are no active API keys. Please contact the administrator.'
      }, 503);
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
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        adaptiveTimeout.decreaseTimeout();
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Referrer-Policy', 'no-referrer');

        const contentType = response.headers.get('content-type') || '';
        let body;
        if (contentType.includes('application/json')) {
            body = JSON.stringify(await response.json());
        } else if (contentType.includes('text/')) {
            body = await response.text();
        } else {
            body = await response.arrayBuffer();
        }

        return new Response(body, {
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
    } finally {
      attempts++;
    }
  }

  return new Response('The request failed after multiple retries.', {
    status: 502,
  });
}
