import "dotenv/config";
import { kv } from "@vercel/kv";
import { readFile } from "fs/promises";

async function main() {
  console.log("--- 开始更新 Vercel KV Gemini 密钥集合 (Set) ---");
  const setName = 'gemini_keys_set';

  try {
    // 1. 清理旧的 Set
    console.log(`正在删除旧的 Set: ${setName}...`);
    await kv.del(setName);
    console.log("旧 Set 已成功删除。");

    // 2. 读取密钥文件
    const keyFilePath = "/Users/addison/工具/API Keys/gemini-key.md";
    console.log(`正在从 ${keyFilePath} 读取密钥...`);
    const fileContent = await readFile(keyFilePath, "utf-8");
    const apiKeys = fileContent.split('\n').map(line => line.trim()).filter(Boolean);

    if (apiKeys.length === 0) {
      console.log("警告: 未在文件中找到任何 API 密钥。");
      return;
    }

    console.log(`成功读取 ${apiKeys.length} 个密钥，准备写入 Set...`);

    // 3. 批量写入新密钥到 Set
    console.log(`准备将 ${apiKeys.length} 个密钥批量添加到 Set '${setName}'...`);
    if (apiKeys.length > 0) {
      await kv.sadd(setName, ...apiKeys);
    }
    console.log(`所有 ${apiKeys.length} 个密钥已成功添加到 Set '${setName}'。`);

  } catch (error) {
    console.error("脚本执行期间发生错误:", error);
  } finally {
    console.log(`--- Vercel KV 更新脚本 (Set: ${setName}) 执行完毕 ---`);
  }
}

main();
