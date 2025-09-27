// __tests__/api_keys.test.js
import keyApiHandler from '../api/keys.js';
import { addKey, verifyAdminKey } from '../src/key_manager.js';

// Mock the key_manager module
jest.mock('../src/key_manager.js', () => ({
  verifyAdminKey: jest.fn(),
  addKey: jest.fn(),
  getAllKeys: jest.fn(),
  deleteKey: jest.fn(),
}));

describe('/api/keys handler', () => {
  const mockEnv = {
    ADMIN_LOGIN_KEY: 'test-admin-key',
  };

  beforeEach(() => {
    process.env.ADMIN_LOGIN_KEY = 'test-admin-key';
    // Reset mocks before each test
    addKey.mockClear();
    verifyAdminKey.mockClear();
  });

  test('should return 401 Unauthorized if verifyAdminKey returns false', async () => {
    verifyAdminKey.mockReturnValue(false);

    const request = new Request('http://localhost/api/keys', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer wrong-key' },
      body: JSON.stringify({ key: 'a-new-api-key' })
    });

    const response = await keyApiHandler.fetch(request, mockEnv);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ success: false, message: 'Unauthorized' });
  });

  test('should return 400 Bad Request if "key" is missing in POST body', async () => {
    verifyAdminKey.mockReturnValue(true);

    const request = new Request('http://localhost/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-admin-key' },
      body: JSON.stringify({ not_a_key: 'some-value' }) // Missing 'key'
    });

    const response = await keyApiHandler.fetch(request, mockEnv);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ success: false, message: 'Bad Request: "key" is required.' });
  });

  test('should call addKey and return 201 Created on successful POST', async () => {
    verifyAdminKey.mockReturnValue(true);
    addKey.mockResolvedValue({ success: true, message: 'Key added successfully.' });

    const newApiKey = 'a-valid-gemini-api-key';
    const request = new Request('http://localhost/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-admin-key' },
      body: JSON.stringify({ key: newApiKey })
    });

    const response = await keyApiHandler.fetch(request, mockEnv);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ success: true, message: 'Key added successfully.' });

    // Verify that addKey was called with the correct arguments
    expect(addKey).toHaveBeenCalledTimes(1);
    expect(addKey).toHaveBeenCalledWith(newApiKey, expect.objectContaining({ ADMIN_LOGIN_KEY: mockEnv.ADMIN_LOGIN_KEY }));
  });
});
