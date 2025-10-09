
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('错误：环境变量 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 是必须的。');
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL || `rediss://:${UPSTASH_REDIS_REST_TOKEN}@${UPSTASH_REDIS_REST_URL.replace('https://', '')}`;
const redis = new Redis(redisUrl);

const queryKey = async () => {
  const apiKey = process.argv[2];

  if (!apiKey) {
    console.error('错误：请提供一个 API 密钥作为参数。');
    console.error('用法: node scripts/query-key.js <api_key>');
    process.exit(1);
  }

  try {
    console.log(`正在查询密钥: ${apiKey}`);
    const keyData = await redis.hgetall(`key:${apiKey}`);

    if (Object.keys(keyData).length === 0) {
      console.log('未找到该密钥。');
    } else {
      console.log('--- 密钥详情 ---');
      console.log(keyData);
      console.log('------------------');
    }

  } catch (error) {
    console.error('在与 Redis 交互时发生严重错误:', error);
    process.exit(1);
  } finally {
    redis.quit();
  }
};

queryKey();
