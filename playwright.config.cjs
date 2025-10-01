
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  // Files to run as tests
  testMatch: ['tests/final_validation.js'],

  // Base URL to use in actions like `await page.goto('/')`
  use: {
    baseURL: 'http://localhost:3000',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
