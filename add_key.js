
import { addKey } from './src/key_manager.js';
import 'dotenv/config';

(async () => {
  const newKey = process.env.GEMINI_API_KEY;

  if (!newKey) {
    console.error('错误：请在 .env 文件中或作为环境变量设置 GEMINI_API_KEY。');
    process.exit(1);
  }

  console.log(`正在尝试添加密钥：${newKey.substring(0, 4)}...`);

  try {
    const result = await addKey(newKey);
    if (result.success) {
      console.log('成功:', result.message);
    } else {
      console.error('失败:', result.message);
    }
  } catch (error) {
    console.error('执行脚本时发生意外错误:', error);
  }
})();
