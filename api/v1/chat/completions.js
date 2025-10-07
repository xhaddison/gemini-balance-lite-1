import { KeyManager, NoAvailableKeysError, NonRetriableError } from '../../../src/key_manager.js';

let keyManager; // Declare outside the handler to act as a singleton across invocations in the same warm container

const handler = async (req) => {
    if (!keyManager) {
        console.log(`[${new Date().toISOString()}] [DIAG] PRE: Initializing KeyManager instance for the first time.`);
        try {
            keyManager = new KeyManager();
            console.log(`[${new Date().toISOString()}] [DIAG] POST: KeyManager instance successfully initialized.`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] [DIAG] CRITICAL: Failed to initialize KeyManager instance.`, error);
            return new Response('Service Unavailable: Failed to initialize core component.', { status: 503 });
        }
    }
    console.log(`[${new Date().toISOString()}] [DIAG] Request received.`);

    // 1. 请求验证
    if (req.method === 'GET') {
        console.log(`[${new Date().toISOString()}] [DIAG] Responding to GET request.`);
        return new Response('Canary is alive: version-final-debug', { status: 200 });
    }
    if (req.method !== 'POST') {
        console.log(`[${new Date().toISOString()}] [DIAG] Method not allowed: ${req.method}.`);
        return new Response('Method Not Allowed', { status: 405 });
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log(`[${new Date().toISOString()}] [DIAG] Unauthorized: Missing or invalid Authorization header.`);
        return new Response('Unauthorized', { status: 401 });
    }

    // 我们仅验证Header存在，不验证token本身，因为这是一个代理
    const clientToken = authHeader.substring(7);

    const model = 'gemini-pro'; // Temporarily hardcode model, as we can't read body yet
    const targetUrl = `https://generativelen/v1beta/models/${model}:generateContent`;

    // 2. 健壮的密钥处理与重试循环
    const maxRetries = 10; // 设置一个最大重试次数以防无限循环
    for (let i = 0; i < maxRetries; i++) {
        let apiKey = null;
        try {
            console.log(`[${new Date().toISOString()}] [DIAG] PRE: Attempt ${i + 1} calling keyManager.getKey().`);
            apiKey = await keyManager.getKey();
            console.log(`[${new Date().toISOString()}] [DIAG] POST: Attempt ${i + 1} keyManager.getKey() returned key ${apiKey ? apiKey.substring(0, 4) + '...' : 'null'}.`);

            // 2.2 外部调用
            console.log(`[${new Date().toISOString()}] [DIAG] PRE: Attempt ${i + 1} making fetch call.`);
            const response = await fetch(`${targetUrl}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: req.body,
            });
            console.log(`[${new Date().toISOString()}] [DIAG] POST: Attempt ${i + 1} fetch call completed. Status: ${response.status}.`);


            // 2.3 成功处理
            if (response.ok) {
                console.log(`[${new Date().toISOString()}] [DIAG] PRE: Attempt ${i + 1} calling keyManager.handleSuccess().`);
                await keyManager.handleSuccess(apiKey);
                console.log(`[${new Date().toISOString()}] [DIAG] POST: Attempt ${i + 1} keyManager.handleSuccess() completed.`);
                // 直接将 Gemini API 的完整响应返回给客户端
                return new Response(response.body, {
                    status: response.status,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }

            // 2.4 失败处理
            const statusCode = response.status;
            console.error(`[${new Date().toISOString()}] [DIAG] Attempt ${i + 1} failed with key ${apiKey.substring(0, 4)}...: Status ${statusCode}`);
            console.log(`[${new Date().toISOString()}] [DIAG] PRE: Attempt ${i + 1} calling keyManager.handleFailure().`);
            await keyManager.handleFailure(apiKey, statusCode);
            console.log(`[${new Date().toISOString()}] [DIAG] POST: Attempt ${i + 1} keyManager.handleFailure() completed.`);
            // 继续下一次循环以重试

        } catch (error) {
            // 2.5 错误处理
            console.error(`[${new Date().toISOString()}] [DIAG] CRITICAL: Raw error caught in handler loop:`, error);
            if (apiKey && !(error instanceof NoAvailableKeysError) && !(error instanceof NonRetriableError)) {
                 // 如果是 fetch 网络错误等，也需要处理密钥
                 // 这里的状态码 500 是一个内部代码，代表“未知网络错误”，可触发重试
                console.log(`[${new Date().toISOString()}] [DIAG] PRE: Attempt ${i + 1} calling keyManager.handleFailure() for caught error.`);
                await keyManager.handleFailure(apiKey, 500);
                console.log(`[${new Date().toISOString()}] [DIAG] POST: Attempt ${i + 1} keyManager.handleFailure() for caught error completed.`);
            }

            if (error instanceof NoAvailableKeysError) {
                // 密钥池已耗尽
                console.error(`[${new Date().toISOString()}] [DIAG] All API keys are exhausted.`);
                return new Response('Service Unavailable: No available API keys.', { status: 503 });
            }

            if (error instanceof NonRetriableError) {
                // 不可重试的错误 (例如，400 Bad Request)
                console.error(`[${new Date().toISOString()}] [DIAG] Non-retriable error encountered.`, error.message);
                return new Response(`Bad Request: ${error.message}`, { status: 400 });
            }

            // 其他未知错误，记录日志但继续重试
            console.error(`[${new Date().toISOString()}] [DIAG] An unexpected error occurred during attempt ${i + 1}:`, error);
        }
    }

    // 如果循环结束仍未成功，返回 503
    console.log(`[${new Date().toISOString()}] [DIAG] Max retries exceeded.`);
    return new Response('Service Unavailable: Max retries exceeded.', { status: 503 });
};

export default handler;
