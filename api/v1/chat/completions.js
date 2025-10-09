import { KeyManager, NoAvailableKeysError } from '../../../src/key_manager.js';

// Top-level, blocking, pre-flight checks and initialization.
// This code runs once during the Vercel function's cold start.
const keyManagerPromise = (async () => {
    // 1. Enforce startup environment variable checks.
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error(`[${new Date().toISOString()}] [CRITICAL] Missing required Redis environment variables. Function will not start.`);
        throw new Error('Configuration Error: Missing Redis credentials. The function cannot start.');
    }

    // 2. Initialize KeyManager.
    console.log(`[${new Date().toISOString()}] [INFO] Initializing KeyManager instance...`);
    const manager = new KeyManager();
    await manager.initialize();
    console.log(`[${new Date().toISOString()}] [INFO] KeyManager initialized successfully.`);
    return manager;
})();

// Helper function for exponential backoff
const delay = (duration) => new Promise(resolve => setTimeout(resolve, duration));

const handler = async (req) => {
    let keyManager;
    try {
        keyManager = await keyManagerPromise;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] [CRITICAL] KeyManager failed to initialize during cold start.`, error);
        // This response will be served for all subsequent requests until the function instance is recycled.
        return new Response('Service Unavailable: Core component failed to initialize.', { status: 503 });
    }

    if (req.method === 'GET') {
        return new Response('API Router is alive.', { status: 200 });
    }
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await req.json();
    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        let apiKey = null;
        try {
            const keyObject = await keyManager.getBestKey();
            apiKey = keyObject.apiKey;

            await keyManager.lockKey(apiKey);

            // This is the core logic loop.
            // A `finally` block outside this `try...catch` ensures the key is always released.
            try {
                const model = 'gemini-pro';
                const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

                const response = await fetch(`${targetUrl}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(8000), // 8-second timeout
                });

                if (response.ok) {
                    // Success
                    const quotaRemaining = response.headers.get('x-ratelimit-remaining');
                    const quotaReset = response.headers.get('x-ratelimit-reset');
                    const quotaInfo = {
                        remaining: quotaRemaining ? parseInt(quotaRemaining, 10) : undefined,
                        resetTime: quotaReset,
                    };
                    await keyManager.updateKey(apiKey, true, response.status, quotaInfo);
                    // On success, we release the key and return immediately.
                    await keyManager.releaseKey(apiKey);
                    return new Response(response.body, {
                        status: response.status,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Handle non-5xx failures
                const statusCode = response.status;
                const responseBody = await response.text(); // Consume the response body to prevent hanging

                // Key-specific failures that should trigger a retry with the next key
                if ([401, 403, 429].includes(statusCode)) {
                    const reason = statusCode === 429 ? 'quota exceeded' : 'invalid auth';
                    console.warn(`[${new Date().toISOString()}] [WARN] Key failure (${reason}) for ${apiKey.substring(0, 4)}... (Status ${statusCode}). Disabling and retrying.`);
                    await keyManager.updateKey(apiKey, false, statusCode);
                    continue; // Immediately try the next key
                }

                // Other client-side errors that are not key-specific and should not be retried
                if (statusCode < 500) {
                    console.error(`[${new Date().toISOString()}] [ERROR] Non-retriable upstream error for key ${apiKey.substring(0, 4)}...: Status ${statusCode}`);
                    await keyManager.updateKey(apiKey, false, statusCode);
                    // Do not return here, let the key be released and then exit the loop.
                    lastError = new Error(`Upstream error: ${statusCode}. Body: ${responseBody}`);
                    break; // Exit loop, key will be released.
                }

                // It's a 5xx error, so we retry
                console.warn(`[${new Date().toISOString()}] [WARN] Retriable server error for key ${apiKey.substring(0, 4)}...: Status ${statusCode}. Attempt ${attempt + 1}/${maxRetries}.`);
                await keyManager.updateKey(apiKey, false, statusCode);

                // Exponential backoff with jitter
                const backoffTime = Math.pow(2, attempt) * 100 + Math.random() * 100;
                await delay(backoffTime);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [CRITICAL] Error in handler loop attempt ${attempt + 1}:`, error);
                lastError = error;

                if (error.name === 'TimeoutError' || error.name === 'DOMException') {
                    console.warn(`[${new Date().toISOString()}] [WARN] Request timed out for key ${apiKey.substring(0, 4)}... Penalizing with 504.`);
                    await keyManager.updateKey(apiKey, false, 504);
                    continue; // Move to the next key
                }

                if (error instanceof NoAvailableKeysError) {
                    // This is a special case where no key was available to begin with.
                    return new Response('Service Unavailable: All keys are currently busy or disabled.', { status: 503 });
                }

                // On any other unexpected error, penalize the key.
                console.warn(`[${new Date().toISOString()}] [WARN] Unexpected error with key ${apiKey.substring(0, 4)}... Penalizing.`, error.message);
                await keyManager.updateKey(apiKey, false, 499); // Use 499 as a client-side error code
            }
        } catch (error) {
            // This outer catch handles errors from getBestKey or lockKey
            console.error(`[${new Date().toISOString()}] [CRITICAL] Failed to acquire or lock a key.`, error);
            lastError = error;
            if (error instanceof NoAvailableKeysError) {
                return new Response('Service Unavailable: All keys are currently busy or disabled.', { status: 503 });
            }
            // If we can't even get a key, wait a bit before the next top-level retry
            await delay(100);
        } finally {
            if (apiKey) {
                // ESSENTIAL: Ensure the key is ALWAYS released if it was locked.
                await keyManager.releaseKey(apiKey);
            }
        }
    }

    console.error(`[${new Date().toISOString()}] [CRITICAL] Max retries exceeded. Last error:`, lastError);
    return new Response('Service Unavailable: Max retries exceeded.', { status: 503 });
};

export default handler;
