const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    console.log('--- 开始获取页面渲染后的 HTML ---');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const targetUrl = 'https://gemini-balance-lite.vercel.app';

    console.log(`正在导航到: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('页面加载完成。');

    console.log('正在提取 <body> 的 HTML 内容...');
    // 使用 page.content() 获取完整的 HTML 文档
    const pageHTML = await page.content();

    console.log('\n--- 完整的页面 HTML 内容 ---');
    console.log(pageHTML);

  } catch (error) {
    console.error('--- 诊断脚本执行失败 ---');
    console.error('测试过程中发生错误:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭。');
    }
  }
})();
