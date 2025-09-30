
// api/diag.js
import { Redis } from '@upstash/redis';

export default {
  async fetch(request, ctx) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    const maskedUrl = url ? `${url.substring(0, 8)}...${url.substring(url.length - 4)}` : 'Not Set';
    const maskedToken = token ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}` : 'Not Set';

    let connectionStatus = 'Unknown';
    let errorMessage = '';

    if (url && token) {
      try {
        const redis = new Redis({ url, token });
        await redis.ping();
        connectionStatus = 'Success';
      } catch (error) {
        connectionStatus = 'Failed';
        errorMessage = error.message;
      }
    } else {
      connectionStatus = 'Failed';
      errorMessage = 'URL or Token is not set in environment variables.';
    }

    const report = {
      diagnostics: {
        upstashConnection: {
          status: connectionStatus,
          details: {
            url: maskedUrl,
            token: maskedToken,
            error: errorMessage,
          },
        },
      },
    };

    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
