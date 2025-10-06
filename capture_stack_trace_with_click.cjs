const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    console.log('--- 开始前端交互错误堆栈跟踪诊断 ---');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const targetUrl = 'https://gemini-balance-lite.vercel.app';
    const menuButtonSelector = 'header button'; // 假设菜单按钮在 header 标签内

    let stackTrace = null;

    console.log('正在设置 console 错误监听器...');
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('toggleDrawer is not defined')) {
        console.log('--- 捕获到目标错误! ---');
        console.log('错误消息:', msg.text());
        for (const arg of msg.args()) {
           const potentialError = arg.remoteObject();
           if (potentialError && potentialError.subtype === 'error' && potentialError.description) {
               stackTrace = potentialError.description;
               console.log('--- 成功提取到堆栈跟踪 ---');
           }
        }
      }
    });

    console.log(`正在导航到: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('页面加载完成。');

    console.log(`正在尝试点击菜单按钮 (selector: "${menuButtonSelector}")...`);
    try {
      await page.click(menuButtonSelector, { timeout: 5000 });
      console.log('成功点击菜单按钮。等待错误事件...');
    } catch (e) {
      console.log(`无法找到或点击菜单按钮: ${e.message}`);
      console.log('将仅等待页面加载错误...');
    }

    // 等待一段时间以确保点击事件的后续脚本已执行
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (stackTrace) {
        console.log('\n--- 完整的错误堆栈跟踪信息 ---');
        console.log(stackTrace);
    } else {
        console.log('\n--- 未能捕获到目标错误 ---');
        console.log('在页面加载和点击菜单按钮后，未发生 "toggleDrawer is not defined" 错误。');
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
