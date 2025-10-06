
import { Redis } from '@upstash/redis';

// Hardcoded production environment variables
const redis = new Redis({
  url: 'https://rested-imp-13075.upstash.io',
  token: 'ATMTAAIncDIzNDk1YjYyM2U5OWI0YmM2OWQ1ZTZlNzU4MzMzMTIxMXAyMTMwNzU',
});

(async () => {
  console.log('Attempting to connect to Upstash Redis...');
  try {
    const result = await redis.ping();
    console.log('Redis PING successful. Result:', result);
  } catch (error) {
    console.error('Error during Redis PING:', error);
    process.exit(1); // Exit with an error code
  }
  console.log('Redis connection test finished.');
})();
