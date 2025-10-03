import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const successScreenshotPath = '/Users/addison/repository/gemini-balance-lite/login_success_screenshot.png';
  const failureScreenshotPath = '/Users/addison/repository/gemini-balance-lite/login_failure_screenshot.png';

  try {
    // 确保截图目录存在
    if (fs.existsSync(successScreenshotPath)) fs.unlinkSync(successScreenshotPath);
    if (fs.existsSync(failureScreenshotPath)) fs.unlinkSync(failureScreenshotPath);

    await page.goto('https://gemini-balance-lite-naasl1815-xhaddisons-projects.vercel.app/admin.html', { timeout: 60000 });

    await page.fill('input[type="password"]', 'claude-code-super-secret-key-2025');

    await page.click('button:has-text("Login")');

    // 等待表示登录成功的关键元素出现
    await page.waitForSelector('#api-keys-container', { timeout: 10000 });

    await page.screenshot({ path: successScreenshotPath });

    console.log(`SUCCESS:${successScreenshotPath}`);

  } catch (error) {
    console.error(`ERROR: Login failed. ${error.message}`);
    try {
      await page.screenshot({ path: failureScreenshotPath });
      console.error(`F_SCREENSHOT:${failureScreenshotPath}`);
    } catch (screenshotError) {
      console.error(`ERROR: Could not take failure screenshot. ${screenshotError.message}`);
    }
  } finally {
    await browser.close();
  }
})();
