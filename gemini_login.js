import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // 1. Navigate to the URL
    await page.goto('https://gemini-balance-lite-naasl1815-xhaddisons-projects.vercel.app/admin.html');

    // 2. Find the password input and fill it
    await page.fill('input[type="password"]', 'claude-code-super-secret-key-2025');

    // 3. Click the login button
    await page.click('button:has-text("Login")');

    // 4. Wait for navigation and verify success
    await page.waitForSelector('h2:has-text("Key Management")', { timeout: 5000 });
    await page.waitForSelector('button:has-text("Add Key")', { timeout: 5000 });

    // 5. Take a screenshot
    const screenshotPath = '/Users/addison/repository/gemini-balance-lite/login_success.png';
    await page.screenshot({ path: screenshotPath });

    console.log(`Success! Screenshot saved to ${screenshotPath}`);

  } catch (error) {
    console.error('An error occurred:', error.message);
    const errorScreenshotPath = '/Users/addison/repository/gemini-balance-lite/login_error.png';
    await page.screenshot({ path: errorScreenshotPath });
    console.error(`Error screenshot saved to ${errorScreenshotPath}`);
  } finally {
    await browser.close();
  }
})();
