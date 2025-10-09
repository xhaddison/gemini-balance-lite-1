
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('错误：环境变量 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 是必须的。');
  process.exit(1);
}

const redisUrl = `rediss://:${UPSTASH_REDIS_REST_TOKEN}@${UPSTASH_REDIS_REST_URL.replace('https://', '')}`;
const redis = new Redis(redisUrl);

const UAT_KEYS = {
  INVALID_HIGH_PRIORITY: 'key-invalid-high-priority',
  VALID_LOW_PRIORITY: 'key-valid-low-priority',
};

const setup = async () => {
  console.log('正在清理环境...');
  await redis.flushdb();
  console.log('环境清理完毕。');

  console.log('正在设置UAT环境...');
  const pipeline = redis.pipeline();

  // 1. 设置高优先级的无效密钥
  const invalidKeyHash = {
    apiKey: UAT_KEYS.INVALID_HIGH_PRIORITY,
    status: 'available',
    reason: '',
    health_score: 0.9,
    lastUsed: '',
    lastFailure: '',
    totalUses: 0,
    totalFailures: 0,
  };
  pipeline.hset(`key:${UAT_KEYS.INVALID_HIGH_PRIORITY}`, invalidKeyHash);
  pipeline.set(`key:${UAT_KEYS.INVALID_HIGH_PRIORITY}:available`, '1');

  // 2. 设置低优先级的有效密钥
  const validKeyHash = {
    apiKey: UAT_KEYS.VALID_LOW_PRIORITY,
    status: 'available',
    reason: '',
    health_score: 0.8,
    lastUsed: '',
    lastFailure: '',
    totalUses: 0,
    totalFailures: 0,
  };
  pipeline.hset(`key:${UAT_KEYS.VALID_LOW_PRIORITY}`, validKeyHash);
  pipeline.set(`key:${UAT_KEYS.VALID_LOW_PRIORITY}:available`, '1');

  await pipeline.exec();
  console.log('UAT环境设置成功:');
  await query(UAT_KEYS.INVALID_HIGH_PRIORITY);
  await query(UAT_KEYS.VALID_LOW_PRIORITY);
};

const query = async (apiKey) => {
  if (!apiKey) {
    console.error('错误: 请提供一个API密钥用于查询。');
    console.error('用法: node scripts/setup-uat-env.js query <apiKey>');
    return;
  }
  console.log(`\n--- 正在查询密钥: ${apiKey} ---`);
  const keyHash = await redis.hgetall(`key:${apiKey}`);
  if (Object.keys(keyHash).length === 0) {
    console.log('未找到密钥。');
  } else {
    console.log(keyHash);
  }
  console.log('------------------------');
};

const cleanup = async () => {
    console.log('正在清理UAT环境...');
    await redis.flushdb();
    console.log('环境清理完毕。');
};

const main = async () => {
  const command = process.argv[2];
  const arg = process.argv[3];

  try {
    switch (command) {
      case 'setup':
        await setup();
        break;
      case 'query':
        await query(arg || UAT_KEYS.INVALID_HIGH_PRIORITY);
        break;
      case 'cleanup':
        await cleanup();
        break;
      default:
        console.log('用法:');
        console.log('  node scripts/setup-uat-env.js setup    - 设置UAT环境');
        console.log('  node scripts/setup-uat-env.js query [apiKey] - 查询密钥状态');
        console.log('  node scripts/setup-uat-env.js cleanup  - 清理UAT环境');
    }
  } catch (error) {
    console.error('脚本执行时发生错误:', error);
  } finally {
    redis.quit();
  }
};

main();
