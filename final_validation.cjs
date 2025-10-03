
const { Redis } = require('@upstash/redis');

async function finalValidation() {
  console.log('--- [Final Validation Script] ---');
  console.log('--- 正在启动最终生产环境验证 ---');

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const adminKey = process.env.ADMIN_LOGIN_KEY;

  // 1. 验证所有必需的环境变量是否存在
  console.log('Step 1: 检查所有必需的环境变量...');
  if (!redisUrl || !redisToken || !adminKey) {
    console.error('🔴 致命错误: 一个或多个关键环境变量 (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_LOGIN_KEY) 在 Vercel 生产环境中缺失。');
    console.log('   - 请立即前往 Vercel 项目设置页面，确保这三个环境变量已为生产环境正确配置。');
    console.log('--- 验证失败 ---');
    return;
  }
  console.log('   ✅ 所有环境变量均已找到。');

  // 2. 尝试连接到 Redis 数据库
  console.log('\nStep 2: 正在连接到 Upstash Redis 数据库...');
  let redis;
  try {
    redis = new Redis({
      url: redisUrl.trim(),
      token: redisToken.trim(),
    });
    // 发送一个轻量级命令来测试连接
    await redis.ping();
    console.log('   ✅ 成功连接到 Redis 数据库。');
  } catch (error) {
    console.error('🔴 致命错误: 无法连接到 Upstash Redis 数据库。');
    console.error('   - 错误详情:', error.message);
    console.log('   - 请验证 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN 的值是否准确无误。');
    console.log('--- 验证失败 ---');
    return;
  }

  // 3. 检查密钥池中的密钥数量
  console.log('\nStep 3: 正在检查 "gemini_keys_set" 密钥池...');
  try {
    const keysInPool = await redis.smembers('gemini_keys_set');

    if (keysInPool && keysInPool.length > 0) {
      console.log(`🟢 成功! 在 Redis 密钥池中找到了 ${keysInPool.length} 个 API 密钥。`);
      console.log('--- 诊断结论 ---');
      console.log('   - 您的 Vercel 生产环境配置完全正确。');
      console.log('   - Redis 连接正常，且密钥池非空。');
      console.log('   - 如果此时 API 仍然返回 502 错误，问题几乎可以肯定是由于池中所有密钥都已失效或被 Google 禁用。');
      console.log('   - 解决方案: 请立即通过管理面板更新或替换所有 API 密钥。');
    } else {
      console.log('🟡 警告! Redis 密钥池 "gemini_keys_set" 为空!');
      console.log('--- 诊断结论 ---');
      console.log('   - 这就是导致您看到 502 错误的根本原因。');
      console.log('   - 您的 Vercel 服务因无密钥可用而无法将请求转发给 Google API。');
      console.log('   - 解决方案: 请立即通过应用的 /admin.html 管理面板添加至少一个有效的 Gemini API 密钥。');
    }
  } catch (error) {
    console.error('🔴 致命错误: 查询 Redis 密钥池时发生错误。');
    console.error('   - 错误详情:', error.message);
    console.log('   - 这可能表示 Redis 服务本身存在问题，或者权限配置不正确。');
    console.log('--- 验证失败 ---');
  }

  console.log('\n--- 验证脚本执行完毕 ---');
}

// 立即执行验证函数
finalValidation();
