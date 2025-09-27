jest.mock('../key_manager');
import { describe, test, expect, afterEach, jest } from '@jest/globals';
import { handleRequest } from '../handle_request';
import * as keyManager from '../key_manager';


// Mock fetch
global.fetch = jest.fn();

describe('handleRequest', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // TC-CORE-01: Core Proxy - Successful Request
  test('should proxy a successful request to the target API', async () => {
    // Arrange
    const mockApiKey = { key: 'test-api-key' };
    keyManager.getRandomKey.mockReturnValue({ key: mockApiKey });

    const mockSuccessResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: 'Success' }),
    };
    global.fetch.mockResolvedValue(new Response(mockSuccessResponse.body, mockSuccessResponse));

    const request = new Request('https://example.com/generateContent', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ message: 'Success' });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // More robustly check the fetch call
    const [fetchUrl, fetchOptions] = global.fetch.mock.calls[0];

    expect(fetchUrl).toBe('https://generativelanguage.googleapis.com/generateContent');
    expect(fetchOptions.headers.get('x-goog-api-key')).toBe(mockApiKey.key);

    expect(keyManager.markSuccess).toHaveBeenCalledWith(mockApiKey.key);
  });

  // TC-KEY-01: Key Management - Key Rotation
  test('should rotate to the next available key for each new request', async () => {
    // Arrange
    const mockApiKeys = [{ key: 'key-1' }, { key: 'key-2' }, { key: 'key-3' }];
    keyManager.getRandomKey
      .mockReturnValueOnce({ key: mockApiKeys[0] })
      .mockReturnValueOnce({ key: mockApiKeys[1] })
      .mockReturnValueOnce({ key: mockApiKeys[2] });

    global.fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Success' }), { status: 200 }));

    const request = new Request('https://example.com/generateContent');

    // Act
    await handleRequest(request, {});
    await handleRequest(request, {});
    await handleRequest(request, {});

    // Assert
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const fetchCalls = global.fetch.mock.calls;
    expect(fetchCalls[0][1].headers.get('x-goog-api-key')).toBe(mockApiKeys[0].key);
    expect(fetchCalls[1][1].headers.get('x-goog-api-key')).toBe(mockApiKeys[1].key);
    expect(fetchCalls[2][1].headers.get('x-goog-api-key')).toBe(mockApiKeys[2].key);
  });

  // TC-KEY-02: Key Management - Quota Exceeded Handling
  test('should switch to the next key when a 429 quota error occurs', async () => {
    // Arrange
    const failingKey = { key: 'failing-key' };
    const workingKey = { key: 'working-key' };

    keyManager.getRandomKey
      .mockReturnValueOnce({ key: failingKey })
      .mockReturnValueOnce({ key: workingKey });
    keyManager.markQuotaExceeded = jest.fn(); // Ensure we can track calls to this

    const mockErrorResponse = new Response(JSON.stringify({ error: 'Quota exceeded' }), { status: 429 });
    const mockSuccessResponse = new Response(JSON.stringify({ message: 'Success' }), { status: 200 });

    global.fetch
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockSuccessResponse);

    const request = new Request('https://example.com/generateContent');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ message: 'Success' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(keyManager.markQuotaExceeded).toHaveBeenCalledWith(failingKey.key);

    const fetchCalls = global.fetch.mock.calls;
    expect(fetchCalls[0][1].headers.get('x-goog-api-key')).toBe(failingKey.key);
    expect(fetchCalls[1][1].headers.get('x-goog-api-key')).toBe(workingKey.key);
  });

  // TC-KEY-03: Key Management - All Keys Unavailable
  test('should return a 502 error when all keys are unavailable', async () => {
    // Arrange
    const MAX_RETRIES = 5;
    const failingKeys = Array.from({ length: MAX_RETRIES }, (_, i) => ({ key: `failing-key-${i + 1}` }));

    // Mock getRandomKey to return failing keys and then null
    const mockGetNextAvailableKey = jest.fn();
    failingKeys.forEach(key => mockGetNextAvailableKey.mockReturnValueOnce({ key }));
    mockGetNextAvailableKey.mockReturnValue(null); // Return null after all keys are used
    keyManager.getRandomKey = mockGetNextAvailableKey;

    // Mock fetch to always return a 429 error
    const mockErrorResponse = new Response(JSON.stringify({ error: 'Quota exceeded' }), { status: 429 });
    global.fetch.mockResolvedValue(mockErrorResponse);

    const request = new Request('https://example.com/generateContent');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(502);
    const responseBody = await response.text();
    expect(responseBody).toBe('The request failed after multiple retries.');
    expect(global.fetch).toHaveBeenCalledTimes(MAX_RETRIES);
  });
});
