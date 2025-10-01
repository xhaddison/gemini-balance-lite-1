
import { chromium } from 'playwright';
import path from 'path';

(async () => {
  let browser;
  const adminKey = process.env.ADMIN_KEY || 'dev-admin-key';
  // 核心变更：直接指向本地文件路径
  const localHtmlPath = `file://${path.join(process.cwd(), 'public', 'admin.html')}`;

  try {
    console.log('开始执行 UAT-001 测试 (网络拦截版)...');
    browser = await chromium.launch();
    const page = await browser.newPage();

    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';

    console.log(`1. 拦截 API 请求并重定向到: ${apiBaseUrl}`);
    // 核心变更：拦截所有 /api/ 开头的请求
    await page.route('**/api/**', async (route, request) => {
      // 移除 URL 中的 file://.../api/ 部分，并与 apiBaseUrl 结合
      const newUrl = new URL(request.url().substring(request.url().indexOf('/api/')), apiBaseUrl).href;

      console.log(`  -> 拦截到请求: ${request.url()}`);
      console.log(`  -> 重定向到: ${newUrl}`);

      const response = await page.request.fetch(request, {
        url: newUrl,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
      });
      route.fulfill({
        status: response.status(),
        headers: await response.headers(),
        body: await response.body(),
      });
    });

    console.log(`2. 直接从文件系统加载页面: ${localHtmlPath}`);
    await page.goto(localHtmlPath);

    console.log('3. 执行管理员登录');
    await page.locator('input[data-testid="admin-key-input"]').fill(adminKey);
    await page.locator('button[data-testid="login-button"]').click();
    await page.locator('#management-section').waitFor({ state: 'visible', timeout: 10000 });
    console.log('  -> 登录成功, 管理界面已加载.');

    const testKey = `test_key_${Date.now()}`;
    console.log(`4. 添加新 Key: ${testKey}`);
    await page.locator('input[data-testid="new-key-input"]').fill(testKey);
    await page.locator('button[data-testid="add-key-button"]').click();

    console.log('5. 验证保存成功信息');
    const successMessage = await page.locator('.message.success');
    await successMessage.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  -> 成功信息已确认.');

    console.log('6. 刷新页面 (重新加载本地文件)');
    await page.reload();

    console.log('7. 重新登录并验证数据持久化');
    await page.locator('input[data-testid="admin-key-input"]').fill(adminKey);
    await page.locator('button[data-testid="login-button"]').click();
    await page.locator('#management-section').waitFor({ state: 'visible', timeout: 5000 });

    const keyElement = await page.locator(`span:has-text("${testKey}")`);
    await keyElement.waitFor({ state: 'visible', timeout: 10000 });

    if (await keyElement.isVisible()) {
      console.log('  -> 数据持久化验证成功.');
      console.log('---');
      console.log('测试结果: 成功');
      console.log('---');
    } else {
      throw new Error('数据持久化验证失败: 刷新后未找到测试数据。');
    }

  } catch (error) {
    console.error('测试执行期间发生错误:', error.message);
    console.log('---');
    console.log('测试结果: 失败');
    console.log('---');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
