
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Redis } from '@upstash/redis';

// Initialize Redis client
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables must be set.');
  process.exit(1);
}
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL.trim(),
  token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(),
});

const keyPrefix = 'key:';

async function addKey(argv) {
  const keyHash = `${keyPrefix}${argv.key}`;
  const now = new Date().toISOString();
  const keyData = {
    apiKey: argv.key,
    provider: argv.provider,
    status: 'available',
    reason: 'initial_addition',
    lastUsed: '',
    lastFailure: '',
    totalUses: 0,
    totalFailures: 0,
    quota_remaining: 1000, // Default value
    quota_reset_time: '',
    health_score: 1.0,
    error_rate: 0.0,
    createdAt: now,
  };
  await redis.hset(keyHash, keyData);
  console.log(`Successfully added key: ${argv.key}`);
  const data = await redis.hgetall(keyHash);
  console.table(data);
}

async function disableKey(argv) {
  const keyHash = `${keyPrefix}${argv.key}`;
  await redis.hset(keyHash, { status: 'disabled', reason: 'manual_disable' });
  console.log(`Successfully disabled key: ${argv.key}`);
  const data = await redis.hgetall(keyHash);
  console.table(data);
}

async function enableKey(argv) {
  const keyHash = `${keyPrefix}${argv.key}`;
  await redis.hset(keyHash, { status: 'available', reason: 'manual_enable' });
  console.log(`Successfully enabled key: ${argv.key}`);
  const data = await redis.hgetall(keyHash);
  console.table(data);
}

async function updateKeyHealth(argv) {
  const keyHash = `${keyPrefix}${argv.key}`;
  await redis.hset(keyHash, { health_score: argv.health_score });
  console.log(`Successfully updated health score for key: ${argv.key}`);
  const data = await redis.hgetall(keyHash);
  console.table(data);
}

async function queryKey(argv) {
  const keyHash = `${keyPrefix}${argv.key}`;
  const data = await redis.hgetall(keyHash);
  if (data) {
    console.log(`Details for key: ${argv.key}`);
    console.table(data);
  } else {
    console.log(`Key not found: ${argv.key}`);
  }
}

yargs(hideBin(process.argv))
  .command('add', 'Add a new API key', (yargs) => {
    return yargs
      .option('key', {
        describe: 'The API key to add',
        demandOption: true,
        type: 'string',
      })
      .option('provider', {
        describe: 'The name of the API provider (e.g., gemini)',
        demandOption: true,
        type: 'string',
      });
  }, addKey)
  .command('disable', 'Disable an API key', (yargs) => {
    return yargs.option('key', {
      describe: 'The API key to disable',
      demandOption: true,
      type: 'string',
    });
  }, disableKey)
  .command('enable', 'Enable an API key', (yargs) => {
    return yargs.option('key', {
      describe: 'The API key to enable',
      demandOption: true,
      type: 'string',
    });
  }, enableKey)
  .command('update', 'Update a key metric', (yargs) => {
    return yargs
      .option('key', {
        describe: 'The API key to update',
        demandOption: true,
        type: 'string',
      })
      .option('health_score', {
          describe: 'The new health score (0.0 to 1.0)',
          demandOption: true,
          type: 'number'
      });
  }, updateKeyHealth)
  .command('query', 'Query details for an API key', (yargs) => {
    return yargs.option('key', {
      describe: 'The API key to query',
      demandOption: true,
      type: 'string',
    });
  }, queryKey)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .argv;
