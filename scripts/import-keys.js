
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


const importKeys = async () => {
  const keysArg = process.argv[2];

  if (!keysArg) {
    console.error('错误：请提供一个逗号分隔的 API 密钥列表作为参数。');
    console.error('用法: node scripts/import-keys.js key1,key2,key3');
    process.exit(1);
  }

  const apiKeys = keysArg.split(',').map(key => key.trim()).filter(Boolean);
  if (apiKeys.length === 0) {
    console.error('错误：提供的密钥列表为空。');
    process.exit(1);
  }

  let importedCount = 0;
  let skippedCount = 0;

  try {
    const pipeline = redis.pipeline();
    const keysToImport = [];

    // 检查哪些密钥已存在
    const existenceChecks = await Promise.all(
        apiKeys.map(apiKey => redis.exists(apiKey))
    );

    apiKeys.forEach((apiKey, index) => {
        if (existenceChecks[index]) {
            console.warn(`警告：密钥 "${apiKey}" 已存在，将跳过。`);
            skippedCount++;
        } else {
            keysToImport.push(apiKey);
        }
    });

    if (keysToImport.length > 0) {
        keysToImport.forEach(apiKey => {
            const keyHash = {
                apiKey,
                status: 'available',
                reason: '', // Storing null can be tricky, empty string is safer
                lastUsed: '',
                lastFailure: '',
                totalUses: 0,
                totalFailures: 0
            };
            pipeline.hset(`key:${apiKey}`, keyHash);
            // Create the availability marker for the new key manager to find
            pipeline.set(`key:${apiKey}:available`, '1');
        });

        await pipeline.exec();
        importedCount = keysToImport.length;
    }

    console.log('\n--- 导入摘要 ---');
    console.log(`成功导入 ${importedCount} 个新密钥。`);
    console.log(`跳过 ${skippedCount} 个已存在的密钥。`);
    console.log('------------------');

  } catch (error) {
    console.error('在与 Redis 交互时发生严重错误:', error);
    process.exit(1);
  } finally {
    redis.quit();
  }
};

importKeys();
