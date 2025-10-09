
import Redis from 'ioredis';

// Per PRD 2.1, establish a standard connection to Redis
const redis = new Redis(process.env.REDIS_URL);

/**
 * Vercel Cron Job for API Key Health Check and Recovery.
 * As defined in PRD v3.0, Section 4: The Recovery Plane.
 */
export default async function handler(req, res) {
  // Security Validation: Ensure the request comes from the Vercel Cron scheduler
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let checkedKeys = 0;
  let recoveredKeys = 0;
  const recoveryPromises = [];

  try {
    // Per PRD 4.1, scan all keys to find potential recovery candidates.
    // The pattern 'key:*' fetches all keys for inspection.
    const stream = redis.scanStream({
      match: 'key:*',
      count: 100,
    });

    for await (const keys of stream) {
      for (const key of keys) {
        const processKey = async (currentKey) => {
          const keyData = await redis.hgetall(currentKey);

          // PRD 4.1 Requirement: Only check keys that are 'disabled' but not for 'invalid_auth'.
          if (keyData.status === 'disabled' && keyData.reason !== 'invalid_auth') {
            checkedKeys++;

            try {
              // PRD 4.2 Requirement: Perform a lightweight health check.
              const apiKey = keyData.apiKey;
              const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;

              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Per PRD, use a minimal, cost-effective payload.
                body: JSON.stringify({
                  contents: [{ parts: [{ text: "x" }] }]
                }),
              });

              // PRD 4.3 Requirement: Define recovery logic based on the check result.
              if (response.ok) { // HTTP 200-299 indicates success
                // On success, atomically update the key's status and metrics.
                const pipeline = redis.multi();
                pipeline.hset(currentKey, 'status', 'available');
                pipeline.hset(currentKey, 'health_score', '0.8'); // Reset to a high initial score
                pipeline.hset(currentKey, 'reason', 'health_check_passed');
                pipeline.hdel(currentKey, 'lastFailure'); // Clear the last failure timestamp

                await pipeline.exec();
                recoveredKeys++;
              } else {
                // On failure, update the lastFailure timestamp to be re-checked later.
                await redis.hset(currentKey, 'lastFailure', new Date().toISOString());
              }
            } catch (error) {
              // Network or other errors during fetch
              console.error(`Health check failed for key ${currentKey}:`, error);
              await redis.hset(currentKey, 'lastFailure', new Date().toISOString());
            }
          }
        };
        recoveryPromises.push(processKey(key));
      }
    }

    // Wait for all health checks to complete.
    await Promise.all(recoveryPromises);

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
