import { test, expect } from '@playwright/test';

const targetUrl = 'http://localhost:3000/admin.html';
const correctAdminKey = 'claude-code-super-secret-key-2025';
const wrongAdminKey = 'wrong-key-for-testing';
const testFileName = 'test_keys_for_upload.txt';
const testFileContent = 'TEST_KEY_1\nTEST_KEY_2\nTEST_KEY_3';

test.describe('Admin Panel E2E Validation', () => {

  test('TC-01: 登录失败验证', async ({ page }) => {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // --- 调试步骤 ---
    // 1. 截取屏幕快照以供视觉检查
    await page.screenshot({ path: 'test-failure-screenshot.png' });
    // 2. 打印页面内容以检查Playwright实际看到的HTML
    console.log(await page.content());
    // --- 结束调试 ---

    await page.locator('[data-testid="admin-key-input"]').fill(wrongAdminKey);
    await page.locator('[data-testid="login-button"]').click();

    // 等待一小段时间，确保没有发生页面跳转
    await page.waitForTimeout(1500);

    // 断言URL仍然是初始的 admin.html 页面
    expect(page.url()).toContain('admin.html');
  });

  test('TC-02: 端到端成功流程验证', async ({ page }) => {
    // 导航并成功登录
    await page.goto(targetUrl);
    await page.locator('[data-testid="admin-key-input"]').fill(correctAdminKey);
    await page.locator('[data-testid="login-button"]').click();

    // 验证管理部分是否可见
    const managementSection = page.locator('[data-testid="key-management-section"]');
    await expect(managementSection).toBeVisible({ timeout: 10000 });

    // 添加一个新的测试密钥
    const newTestKey = `test-key-${Date.now()}`;
    await page.locator('[data-testid="new-key-input"]').fill(newTestKey);
    await page.locator('[data-testid="add-key-button"]').click();

    // 验证新密钥是否出现在列表中
    const newKeyRow = page.locator(`[data-testid="key-row-${newTestKey}"]`);
    await expect(newKeyRow).toBeVisible({ timeout: 10000 });

    // 设置对话框处理，自动接受删除确认
    page.once('dialog', dialog => dialog.accept());

    // 删除刚刚添加的密钥
    await newKeyRow.locator('[data-testid^="delete-btn-"]').click();

    // 验证密钥已从UI中移除
    await expect(newKeyRow).not.toBeVisible({ timeout: 10000 });
  });
});
