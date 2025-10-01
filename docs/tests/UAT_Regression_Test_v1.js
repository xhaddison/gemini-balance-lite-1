
import { test, expect } from '@playwright/test';

const ADMIN_URL = `${process.env.BASE_URL || 'http://localhost:3000'}/admin.html`;
const ADMIN_KEY = process.env.ADMIN_LOGIN_KEY || 'test-admin-key'; // Provide a default for local testing if not set
const TEST_KEY_PREFIX = 'playwright_test_key_';

if (process.env.CI && !process.env.ADMIN_LOGIN_KEY) {
  console.error("Error: ADMIN_LOGIN_KEY environment variable is not set in CI environment.");
  process.exit(1);
}

test.describe('Dynamic Key Management Regression Test with API Mocking', () => {

  // This will act as our in-memory database for the API mock
  let mockKeys = [];
  const generateTestKey = () => `${TEST_KEY_PREFIX}${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    // Reset the mock database before each test
    mockKeys = [];

    // Setup the stateful API mock before navigating
    await page.route('/api/keys', async (route) => {
      const request = route.request();
      const method = request.method();
      const headers = request.headers();
      const requestBody = request.postDataJSON();

      // Simulate authentication
      if (headers['authorization'] !== ADMIN_KEY) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          json: { success: false, message: 'Unauthorized' }
        });
        return;
      }

      switch (method) {
        case 'GET':
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: { success: true, keys: mockKeys }
          });
          break;

        case 'POST':
          const newKey = requestBody.key;
          if (newKey && !mockKeys.includes(newKey)) {
            mockKeys.push(newKey);
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              json: { success: true, message: 'Key added successfully' }
            });
          } else {
            await route.fulfill({
              status: 400,
              contentType: 'application/json',
              json: { success: false, message: 'Invalid key provided' }
            });
          }
          break;

        case 'DELETE':
          const keyToDelete = requestBody.key;
          const initialLength = mockKeys.length;
          mockKeys = mockKeys.filter(k => k !== keyToDelete);

          if (mockKeys.length < initialLength) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              json: { success: true, message: 'Key deleted successfully' }
            });
          } else {
            await route.fulfill({
              status: 404,
              contentType: 'application/json',
              json: { success: false, message: 'Key not found' }
            });
          }
          break;

        default:
          await route.continue();
      }
    });

    // Navigate to the page after setting up the mock
    await page.goto(ADMIN_URL);
    await page.screenshot({ path: 'final-validation.png' });
  });

  test('should not show management section with an incorrect admin key', async ({ page }) => {
    let alertMessage;
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.dismiss();
    });

    await page.locator('[data-testid="admin-key-input"]').fill('wrong-key');
    await page.locator('[data-testid="login-button"]').click();

    const keyManagementSection = page.locator('[data-testid="key-management-section"]');
    await expect(keyManagementSection).not.toBeVisible();

    // The frontend logic itself should trigger the alert on auth failure.
    // We wait for the alert that comes from the application logic.
    await page.waitForEvent('dialog');
    expect(alertMessage).toContain('Authentication failed');
  });

  test('should perform a full lifecycle: login, add, and delete a key', async ({ page }) => {
    // --- 1. Login ---
    await page.locator('[data-testid="admin-key-input"]').fill(ADMIN_KEY);
    await page.locator('[data-testid="login-button"]').click();

    // --- 2. Verify Management Section is Visible ---
    const keyManagementSection = page.locator('[data-testid="key-management-section"]');
    await expect(keyManagementSection).toBeVisible({ timeout: 5000 }); // UI should appear quickly with mocked API

    // --- 3. Add a New Key ---
    const newTestKey = generateTestKey();
    await page.locator('[data-testid="new-key-input"]').fill(newTestKey);
    await page.locator('[data-testid="add-key-button"]').click();

    // --- 4. Verify the Key Appears in the UI (driven by mock response) ---
    // The application should fetch the updated list or add the key to its state,
    // causing the UI to re-render. We assert that this happens automatically.
    const newKeyRow = page.locator(`[data-testid="key-row-${newTestKey}"]`);
    await expect(newKeyRow).toBeVisible();
    await expect(newKeyRow.locator('span')).toHaveText(newTestKey);

    // --- 5. Delete the Key ---
    // The application should show a confirmation dialog.
    page.once('dialog', dialog => dialog.accept());
    await newKeyRow.locator('.delete-btn').click();

    // --- 6. Verify the Key is Removed from the UI (driven by mock response) ---
    // The application should update its state and remove the key from the list.
    // We assert that the UI element for the key is no longer visible.
    await expect(newKeyRow).not.toBeVisible();
  });
});
