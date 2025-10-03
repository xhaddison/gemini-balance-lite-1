
// verify_env.js
// This script safely reads and partially displays a Vercel environment variable.

(async () => {
  try {
    // This environment variable is automatically populated by Vercel during runtime.
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;

    if (!redisUrl) {
      console.log('🔴 错误: 在 Vercel 生产环境中未找到 UPSTASH_REDIS_REST_URL 环境变量。');
      return;
    }

    // For security, we only display the beginning and end of the URL.
    const preview = `${redisUrl.substring(0, 20)}...${redisUrl.substring(redisUrl.length - 20)}`;

    console.log('🟢 成功找到环境变量:');
    console.log(`   UPSTASH_REDIS_REST_URL (部分): ${preview}`);

  } catch (error) {
    console.error('🔴 执行脚本时发生错误:', error);
  }
})();
