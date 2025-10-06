
import { chromium } from 'playwright';
import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.development.local' });

async function runTest() {
  let browser;
  try {
    // 1. Get API Key from Vercel KV (Upstash Redis)
    console.log('Connecting to Vercel KV to retrieve an API key...');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL.trim(),
      token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(),
    });

    const keys = await redis.keys('gemini_key:*');
    if (keys.length === 0) {
      throw new Error('No API keys found in Vercel KV.');
    }
    const randomKeyName = keys[Math.floor(Math.random() * keys.length)];
    const apiKeyRecord = await redis.get(randomKeyName);

    if (!apiKeyRecord) {
        throw new Error(`Invalid or empty record found for key name: ${randomKeyName}`);
    }
    const apiKey = apiKeyRecord;
    console.log(`Successfully retrieved a random API key: ${apiKey.substring(0, 8)}...`);

    // 2. Execute Playwright Test
    console.log('Launching browser...');
    // Using a try-catch for browser launch to provide a better error message if it fails.
    try {
        browser = await chromium.launch({ headless: true });
    } catch (e) {
        console.error("Error launching Playwright browser. It might not be installed.", e);
        console.log("Please try running 'npx playwright install --with-deps'");
        return; // Exit if browser launch fails
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    const targetUrl = 'https://gemini-balance-lite.vercel.app';
    console.log(`Navigating to ${targetUrl}...`);
    await page.goto(targetUrl);

    console.log('Filling in the API key...');
    await page.fill('input[type="password"]', apiKey);

    console.log('Clicking the submit button...');
    await page.click('button[type="submit"]');

    console.log('Waiting for the response...');
    // Wait for the response area to be visible.
    await page.waitForSelector('.prose', { timeout: 20000 });

    const responseText = await page.textContent('body');
    const resultContainerText = await page.textContent('.prose');

    console.log('\n--- Test Result ---');
    if (resultContainerText.includes('查询成功')) {
      console.log('✅ Test Passed: Successfully queried balance.');
      console.log(resultContainerText);
    } else if (resultContainerText.includes('查询失败') || resultContainerText.includes('无效的API Key') || resultContainerText.includes('Internal Server Error')) {
      console.log('❌ Test Failed as Expected: Received an error message.');
      console.log(resultContainerText);
    } else {
        console.log('⚠️ Test outcome uncertain. Full page body content:');
        console.log(responseText);
    }
    console.log('--- End of Test Result ---\n');

  } catch (error) {
    console.error('An error occurred during the UAT test:', error);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

runTest();
