
import { chromium } from 'playwright';
import path from 'path';

const url = 'https://gemini-balance-lite-1i3yeu99a-xhaddisons-projects.vercel.app/admin.html';
const screenshotPath = path.resolve(process.cwd(), 'admin_page_snapshot.png');

async function verifyAdminRisk() {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const fileInput = await page.$('input[type="file"]');
    const submitButton = await page.$('button, input[type="submit"]');

    if (fileInput && submitButton) {
      console.log('VALIDATION_SUCCESS: Potential destructive upload feature found.');
    } else {
      console.log('VALIDATION_FAILURE: Upload feature not found.');
    }

    console.log(`Screenshot saved to: ${screenshotPath}`);

  } catch (error) {
    console.error('An error occurred during verification:', error);
    console.log(`Screenshot may have been saved to: ${screenshotPath}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

verifyAdminRisk();
