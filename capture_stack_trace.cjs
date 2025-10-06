const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    console.log('--- 开始前端错误堆栈跟踪诊断 ---');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const targetUrl = 'https://gemini-balance-lite.vercel.app';

    // 关键步骤: 监听页面的 console 错误事件
    console.log('正在设置 console 错误监听器...');
    let stackTrace = null;

    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('toggleDrawer is not defined')) {
        console.log('--- 捕获到目标错误! ---');
        console.log('错误消息:', msg.text());
        // 错误对象通常作为参数传递，我们需要检查它们以找到堆栈
        for (const arg of msg.args()) {
           const potentialError = arg.remoteObject();
           if (potentialError && potentialError.subtype === 'error' && potentialError.description) {
               // remoteObject().description 通常包含堆栈跟踪
               stackTrace = potentialError.description;
               console.log('--- 成功提取到堆栈跟踪 ---');
           }
        }
      }
    });

    console.log(`正在导航到: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('页面加载完成。等待错误事件...');

    // 等待一段时间以确保所有脚本都已执行
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (stackTrace) {
        console.log('\n--- 完整的错误堆栈跟踪信息 ---');
        console.log(stackTrace);
    } else {
        console.log('\n--- 未能捕获到目标错误 ---');
        console.log('在页面加载期间，未发生 "toggleDrawer is not defined" 错误。');
    }

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
