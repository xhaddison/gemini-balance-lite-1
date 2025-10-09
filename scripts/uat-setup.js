
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('错误：环境变量 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 是必须的。');
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL || `rediss://:${UPSTASH_REDIS_REST_TOKEN}@${UPSTASH_REDIS_REST_URL.replace('https://', '')}`;
const redis = new Redis(redisUrl);

const setupTestKeys = async () => {
  // 格式: node scripts/uat-setup.js key1:score1,key2:score2,...
  const args = process.argv[2];

  if (!args) {
    console.error('错误：请提供 "密钥:健康分" 对。');
    console.error('用法: node scripts/uat-setup.js key1:0.9,key2:0.5');
    process.exit(1);
  }

  const keyConfigs = args.split(',').map(arg => {
    const [apiKey, scoreStr] = arg.split(':');
    const health_score = parseFloat(scoreStr);
    if (!apiKey || isNaN(health_score)) {
      return null;
    }
    return { apiKey: apiKey.trim(), health_score };
  }).filter(Boolean);

  if (keyConfigs.length === 0) {
    console.error('错误：提供的参数格式不正确。');
    process.exit(1);
  }

  try {
    const pipeline = redis.pipeline();

    keyConfigs.forEach(({ apiKey, health_score }) => {
      const keyHash = {
        apiKey,
        status: 'available',
        reason: 'uat_setup',
        lastUsed: '',
        lastFailure: '',
        totalUses: 0,
        totalFailures: 0,
        health_score: health_score,
        error_rate: 0,
        quota_remaining: 100 // Default value for testing
      };
      console.log(`正在为密钥 ${apiKey} 设置 health_score 为 ${health_score}`);
      pipeline.hset(`key:${apiKey}`, keyHash);
      pipeline.set(`key:${apiKey}:available`, '1');
    });

    await pipeline.exec();
    console.log(`\n成功为 ${keyConfigs.length} 个密钥设置了测试状态。`);

  } catch (error) {
    console.error('在与 Redis 交互时发生严重错误:', error);
    process.exit(1);
  } finally {
    redis.quit();
  }
};

setupTestKeys();
