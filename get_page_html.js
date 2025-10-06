import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  let browser;
  try {
    console.log('--- 开始抓取页面 HTML ---');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const targetUrl = 'https://gemini-balance-lite.vercel.app';

    console.log(`正在导航到: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('页面加载完成。');

    console.log('正在获取页面 HTML 内容...');
    const htmlContent = await page.content();

    // 将 HTML 内容保存到文件以便后续分析
    const outputPath = 'production_page.html';
    fs.writeFileSync(outputPath, htmlContent);
    console.log(`--- 成功 ---`);
    console.log(`页面 HTML 已成功抓取并保存到: ${outputPath}`);

  } catch (error) {
    console.error('--- 脚本执行失败 ---');
    console.error('抓取过程中发生错误:', error.message);
    process.exit(1);

  } finally {
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭。');
    }
  }
})();