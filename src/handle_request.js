import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';
import keyManagerInstance from './key_manager.js';

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  // OpenAI 格式的请求由 openai.mjs 处理
  if (url.pathname.includes("/v1")) {
    // 将 keyManagerInstance 传递给 openai.fetch
    return openai.fetch(request, env, keyManagerInstance);
  }

  // Gemini API 的直接请求处理
  const pathname = url.pathname;
  const search = url.search;
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

  let attempts = 0;
  const maxAttempts = keyManagerInstance.apiKeyPool.length;

  while (attempts < maxAttempts) {
    let apiKey;
    try {
      const keyObject = keyManagerInstance.getNextAvailableKey();
      apiKey = keyObject.key;
    } catch (error) {
      // 捕获所有密钥都已用尽的错误
      return new Response(error.message, { status: 503 });
    }

    attempts++;
    const headers = new Headers(request.headers);
    headers.set('x-goog-api-key', apiKey);

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body
      });

      // 如果是配额问题 (429)，则标记该 key 并尝试下一个
      if (response.status === 429) {
        console.warn(`API Key ${apiKey.substring(0, 4)}... hit a rate limit (429).`);
        keyManagerInstance.markQuotaExceeded(apiKey);
        continue; // 立即尝试下一个 key
      }

      // 对于任何其他非 OK 的响应，我们只做简单的重试，不禁用 key
      if (!response.ok) {
        console.warn(`API Key ${apiKey.substring(0, 4)}... failed with status ${response.status}. Retrying with next key.`);
        continue;
      }

      // 成功，直接返回响应
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Referrer-Policy', 'no-referrer');
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });

    } catch (error) {
      // 网络错误或其他 fetch 异常
      console.error(`Request with key ${apiKey.substring(0, 4)}... failed: ${error}`);
      // 网络问题不禁用 key，直接尝试下一个
    }
  }

  // 如果循环结束还没有成功返回，说明所有 key 都尝试失败了
  return new Response('All available API keys failed to process the request after multiple attempts.', {
    status: 502, // Bad Gateway
  });
}

