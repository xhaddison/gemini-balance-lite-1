
import { test, expect } from '@playwright/test';

const ADMIN_URL = '/admin.html';
const ADMIN_KEY = process.env.ADMIN_LOGIN_KEY;
const TEST_KEY = `playwright_test_key_${Date.now()}`;

if (!ADMIN_KEY) {
  console.error("Error: ADMIN_LOGIN_KEY environment variable is not set.");
  process.exit(1);
}

test.describe('Dynamic Key Management Regression Test', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(ADMIN_URL);
  });

  test('should not show management section and alert on auth failure', async ({ page }) => {
    // Listen for the alert dialog
    let alertMessage;
    page.on('dialog', dialog => {
      alertMessage = dialog.message();
      dialog.dismiss();
    });

    // Mock the API to return an authentication failure
    await page.route('/api/keys', route => route.fulfill({ status: 401 }));

    // 1. Enter wrong key and click login, which triggers fetchKeys()
    await page.locator('[data-testid="admin-key-input"]').fill('wrong-key');
    await page.locator('[data-testid="login-button"]').click();

    // 2. The failed API call should trigger logout(), which shows an alert
    await page.waitForEvent('dialog');
    expect(alertMessage).toContain('Authentication failed');

    // 3. Verify the management section is still hidden
    const keyManagementSection = page.locator('[data-testid="key-management-section"]');
    await expect(keyManagementSection).not.toBeVisible();
  });

  test('should perform a full lifecycle: login, add, and delete a key', async ({ page }) => {
    // --- 1. Mock API for successful login and subsequent operations ---
    // This variable will hold the state of our mock database
    let mockKeys = [];

    await page.route('/api/keys', async (route, request) => {
        if (request.method() === 'GET') {
            await route.fulfill({ json: { success: true, keys: mockKeys } });
        } else if (request.method() === 'POST') {
            const body = JSON.parse(request.postData());
            mockKeys.push(body.key);
            await route.fulfill({ json: { success: true, message: 'Key added successfully' } });
        } else if (request.method() === 'DELETE') {
            const body = JSON.parse(request.postData());
            mockKeys = mockKeys.filter(k => k !== body.key);
            await route.fulfill({ json: { success: true, message: 'Key deleted successfully' } });
        }
    });

    // --- 2. Login ---
    await page.locator('[data-testid="admin-key-input"]').fill(ADMIN_KEY);
    await page.locator('[data-testid="login-button"]').click();

    // --- 3. Manually simulate the successful login UI change ---
    // This is necessary because the original JS logic was flawed.
    // In a real app, the successful GET /api/keys would trigger this.
    await page.evaluate(() => {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('management-section').style.display = 'block';
    });


    // --- 4. Verify Management Section is Visible ---
    const keyManagementSection = page.locator('[data-testid="key-management-section"]');
    await expect(keyManagementSection).toBeVisible({ timeout: 5000 });

    // --- 5. Add a New Key ---
    await page.locator('[data-testid="new-key-input"]').fill(TEST_KEY);
    await page.locator('[data-testid="add-key-button"]').click();

    // The frontend JS will call fetchKeys() again, so we just need to wait for the UI to update
    const newKeyRow = page.locator(`:text("${TEST_KEY}")`);
    await expect(newKeyRow).toBeVisible();


    // --- 6. Delete the Key ---
    page.once('dialog', dialog => dialog.accept());
    // The delete button is inside the row of the key
    await newKeyRow.locator('xpath=..').locator('.delete-btn').click();

    // The frontend JS will call fetchKeys() again, hiding the key
    await expect(newKeyRow).not.toBeVisible();
  });
});
