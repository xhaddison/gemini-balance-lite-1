
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // 1. Navigate to the URL
    await page.goto('https://gemini-balance-lite-naasl1815-xhaddisons-projects.vercel.app/admin.html');

    // 2. Find and fill the password input
    await page.fill('input[type="password"]', 'prod_secret_key_for_gemini_dashboard_2025');

    // 3. Click the login button
    await page.click('button:has-text("Login")');

    // 4. Wait for navigation and verify login by looking for the "Add Key" button
    await page.waitForSelector('button:has-text("Add Key")');

    // 5. Take a screenshot
    const screenshotPath = '/Users/addison/repository/gemini-balance-lite/login_screenshot.png';
    await page.screenshot({ path: screenshotPath });

    console.log(`成功登录并截图，文件保存在: ${screenshotPath}`);

  } catch (error) {
    console.error('登录或截图过程中发生错误:', error);
    // Attempt to take a screenshot even on failure for debugging
    const errorScreenshotPath = '/Users/addison/repository/gemini-balance-lite/login_failure_screenshot.png';
    await page.screenshot({ path: errorScreenshotPath });
    console.log(`错误截图保存在: ${errorScreenshotPath}`);

  } finally {
    await browser.close();
  }
})();
