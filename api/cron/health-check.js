import Redis from 'ioredis';

// Initialize Redis client using the project's standard connection logic
const redisUrl = process.env.REDIS_URL || `redis://:${process.env.UPSTASH_REDIS_REST_TOKEN}@${process.env.UPSTASH_REDIS_REST_URL.replace('https://', '')}`;
const redis = new Redis(redisUrl);

export default async function handler(req, res) {
  // 1. Security Validation
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let checkedKeys = 0;
  let recoveredKeys = 0;

  try {
    // 2. Get all disabled keys
    const stream = redis.scanStream({
      match: 'key:*:disabled',
      count: 100,
    });

    const recoveryPromises = [];

    for await (const keys of stream) {
      for (const key of keys) {
        checkedKeys++;

        const processKey = async (currentKey) => {
          // 3. Get key details
          const keyData = await redis.hgetall(currentKey);

          // 4. Filter keys for recovery
          if (keyData.reason === 'server_error' && keyData.lastFailure) {
            const lastFailureTime = new Date(keyData.lastFailure).getTime();
            const oneHourAgo = Date.now() - 3600 * 1000; // 1 hour in milliseconds

            if (lastFailureTime < oneHourAgo) {
            const apiKey = currentKey.split(':')[1];
            const newKey = `key:${apiKey}:available`;

            // 5. Recover key using a pipeline for atomic operations
            const pipeline = redis.pipeline();
            pipeline.hset(currentKey, 'status', 'available');
            pipeline.hset(currentKey, 'reason', '');
            pipeline.hset(currentKey, 'lastFailure', '');
            pipeline.rename(currentKey, newKey);

            await pipeline.exec();
            recoveredKeys++;
          }
        };
        recoveryPromises.push(processKey(key));
      }
    }

    await Promise.all(recoveryPromises);

    // 6. Respond with the result
    return res.status(200).json({
      message: 'Health check completed successfully.',
      checkedKeys,
      recoveredKeys,
    });

  } catch (error) {
    console.error('Error during cron job execution:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
