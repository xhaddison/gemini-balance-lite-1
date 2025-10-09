import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const result = await redis.ping();

    if (result === 'PONG') {
      return new Response(
        JSON.stringify({
          status: 'success',
          message: result,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      throw new Error(`PING command returned an unexpected result: ${result}`);
    }
  } catch (error) {
    return new Response(
        JSON.stringify({
          status: 'failure',
          error: error.message,
          errorName: error.name,
          errorStack: error.stack,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
  }
}
