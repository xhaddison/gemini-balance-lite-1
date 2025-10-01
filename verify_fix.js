
import fetch from 'node-fetch';

const TARGET_URL = 'http://localhost:3000/admin.html';
const EXPECTED_STRING = 'data-testid="admin-key-input"';

async function verifyServerResponse() {
  console.log(`正在请求: ${TARGET_URL}`);
  try {
    const response = await fetch(TARGET_URL);
    const body = await response.text();

    console.log('---- [服务器响应内容] ----');
    console.log(body);
    console.log('--------------------------');


    if (response.status === 200 && body.includes(EXPECTED_STRING)) {
      console.log('✅ 验证成功: 服务器正确返回了 admin.html 的内容。');
      console.log(`  -> 找到了关键字符串: "${EXPECTED_STRING}"`);
      process.exit(0);
    } else {
      console.error('❌ 验证失败: 服务器未能正确提供 admin.html。');
      if (response.status !== 200) {
        console.error(`  -> HTTP 状态码: ${response.status}`);
      }
      if (!body.includes(EXPECTED_STRING)) {
         console.error(`  -> 响应内容中未找到关键字符串: "${EXPECTED_STRING}"`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    process.exit(1);
  }
}

verifyServerResponse();
