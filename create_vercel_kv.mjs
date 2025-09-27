
import puppeteer from 'puppeteer';

const VERCEL_PROJECT_URL = 'https://vercel.com/addisons-team/gemini-balance-lite';
const KV_DATABASE_NAME = 'gemini-balance-lite-kv';

async function main() {
    console.log('启动交互式浏览器自动化...');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null, // Use the browser's default viewport
        args: ['--start-maximized'] // Start browser maximized
    });
    const page = await browser.newPage();

    try {
        console.log('导航到 Vercel 登录页面...');
        await page.goto('https://vercel.com/login', { waitUntil: 'networkidle2' });

        console.log('自动点击 "Continue with GitHub"...');
        const githubButton = await page.waitForSelector('button[data-testid="sso-provider-button-github"]');
        await githubButton.click();

        console.log('\n================================================================');
        console.log('=== 操作已暂停，等待您手动完成 GitHub 登录和授权... ===');
        console.log('=== 请在这个新打开的 Chrome 窗口中完成操作。           ===');
        console.log('=== 登录成功后，脚本将自动接管后续步骤。           ===');
        console.log('================================================================\n');

        await page.waitForNavigation({ timeout: 300000, waitUntil: 'networkidle2' }); // 5 minutes timeout for manual login

        // Wait until the user has logged in and is on a dashboard-like page
        await page.waitForFunction(
            () => document.querySelector('nav[aria-label="Dashboard"] a[href="/dashboard"]') !== null,
            { timeout: 300000 }
        );

        console.log('检测到您已成功登录！脚本现在将自动接管...');

        console.log('导航到项目的 "Storage" 标签页...');
        await page.goto(`${VERCEL_PROJECT_URL}/storage`, { waitUntil: 'networkidle2' });

        console.log('检查 KV 数据库是否已存在...');
        const dbExists = await page.evaluate((name) => {
            const heading = Array.from(document.querySelectorAll('h3')).find(h3 => h3.textContent.trim() === name);
            return !!heading;
        }, KV_DATABASE_NAME);


        if (dbExists) {
            console.log(`KV 数据库 "${KV_DATABASE_NAME}" 已存在。跳过创建步骤。`);
        } else {
            console.log('点击 "Create Database" 并选择 KV Store...');
             const createButton = await page.waitForSelector('button[aria-label="Create a new store"]');
            await createButton.click();

            const kvOption = await page.waitForSelector('div[role="option"] p:nth-child(1)');
            await kvOption.click();

            console.log('输入数据库名称...');
            const nameInput = await page.waitForSelector('input#create-kv-database-name-input');
            await nameInput.type(KV_DATABASE_NAME);

            console.log('提交创建表单...');
            // We need to find the submit button inside the dialog
            const dialog = await page.waitForSelector('div[role="dialog"]');
            const submitButton = await dialog.$('button[type="submit"]');
            await submitButton.click();


            console.log('等待数据库创建完成...');
            await page.waitForFunction(
                (name) => {
                    const heading = Array.from(document.querySelectorAll('h3')).find(h3 => h3.textContent.trim() === name);
                    return !!heading;
                },
                { timeout: 60000 },
                KV_DATABASE_NAME
             );


            console.log(`成功创建 KV 数据库 "${KV_DATABASE_NAME}"。`);
        }

        console.log('\n自动化流程成功完成！');

    } catch (error) {
        console.error('自动化过程中发生错误:', error);
        try {
            const screenshotPath = 'interactive_error_screenshot.png';
            await page.screenshot({ path: screenshotPath });
            console.log(`已将错误截图保存为: ${screenshotPath}`);
        } catch (screenshotError) {
            console.error('无法保存截图:', screenshotError);
        }
    } finally {
        console.log('浏览器将在10秒后自动关闭...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        await browser.close();
    }
}

main();
