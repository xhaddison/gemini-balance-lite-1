// UAT.test.js

// Mock essential modules before any imports
jest.mock('../src/key_manager.js');
jest.mock('../src/utils.js', () => ({
  ...jest.requireActual('../src/utils.js'), // Keep original functions
  calculateRetryDelay: jest.fn().mockReturnValue(0), // No delay in tests
}));
jest.mock('../src/openai.mjs');


import { handleRequest } from '../src/handle_request.js';
import { keyManager } from '../src/key_manager.js';
import { OpenAI } from '../src/openai.mjs';

// Set up global fetch mock
global.fetch = jest.fn();

describe('UAT Automated Tests based on UAT_Plan.md', () => {

  beforeEach(() => {
    // Reset mocks and state before each test
    fetch.mockClear();
    keyManager.getNextAvailableKey.mockClear();
    keyManager.markQuotaExceeded.mockClear();
    keyManager.markServerError.mockClear();
    keyManager.markSuccess.mockClear();
    OpenAI.mockClear();
  });

  /**
   * TC-CORE-01: Core Proxy - Successful Request
   */
  test('TC-CORE-01: should successfully proxy a valid request', async () => {
    // Arrange
    const validKey = { key: 'valid-key' };
    keyManager.getNextAvailableKey.mockReturnValue(validKey);
    const mockSuccessResponse = { content: 'success' };

    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: JSON.stringify(mockSuccessResponse),
      json: async () => mockSuccessResponse,
    });

    const request = new Request('https://gemini-proxy.com/v1beta/models/gemini-pro:generateContent');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockSuccessResponse);
    expect(fetch).toHaveBeenCalledTimes(1);
    const fetchCall = fetch.mock.calls[0];
    expect(fetchCall[0]).toContain('generativelanguage.googleapis.com');
    expect(fetchCall[1].headers.get('x-goog-api-key')).toBe(validKey.key);
    expect(keyManager.markSuccess).toHaveBeenCalledWith(validKey.key);
  });

  /**
   * TC-KEY-02: Key Management - Quota Exceeded Handling
   */
  test('TC-KEY-02: should switch to the next key on 429 error', async () => {
    // Arrange
    const quotaExceededKey = { key: 'quota-key' };
    const validKey = { key: 'valid-key' };
    keyManager.getNextAvailableKey
      .mockReturnValueOnce(quotaExceededKey)
      .mockReturnValueOnce(validKey);

    // Mock first call to fail, second to succeed
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Quota Exceeded' }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: JSON.stringify({ content: 'success' }),
      json: async () => ({ content: 'success' }),
    });

    const request = new Request('https://gemini-proxy.com/generate');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keyManager.markQuotaExceeded).toHaveBeenCalledWith(quotaExceededKey.key);
    expect(keyManager.markSuccess).toHaveBeenCalledWith(validKey.key);
  });

  /**
   * TC-KEY-03: Key Management - All Keys Unavailable
   */
  test('TC-KEY-03: should return 502 when all keys are unavailable', async () => {
    // Arrange
    keyManager.getNextAvailableKey.mockReturnValue(null);
    const request = new Request('https://gemini-proxy.com/generate');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain('The request failed after multiple retries.');
  });

  /**
   * TC-RETRY-01: Resilience - 5xx Server Error Retry
   */
  test('TC-RETRY-01: should retry on a 5xx error and succeed', async () => {
    // Arrange
    const key = { key: 'any-key' };
    keyManager.getNextAvailableKey.mockReturnValue(key);

    fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: JSON.stringify({ content: 'success' }),
      json: async () => ({ content: 'success' }),
    });

    const request = new Request('https://gemini-proxy.com/generate');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keyManager.markServerError).toHaveBeenCalledWith(key.key);
  });

  /**
   * TC-RETRY-02: Resilience - Request Timeout Retry
   */
  test('TC-RETRY-02: should retry on a timeout and succeed', async () => {
    // Arrange
    const key = { key: 'any-key' };
    keyManager.getNextAvailableKey.mockReturnValue(key);

    fetch.mockRejectedValueOnce({ name: 'AbortError' }); // Simulate timeout
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: JSON.stringify({ content: 'success' }),
      json: async () => ({ content: 'success' }),
    });

    const request = new Request('https://gemini-proxy.com/generate');

    // Act
    const response = await handleRequest(request, {});

    // Assert
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keyManager.markServerError).toHaveBeenCalledWith(key.key);
  });

  /**
   * TC-OPENAI-01 & TC-OPENAI-02: OpenAI Proxy routing
   */
  test('TC-OPENAI-01/02: should route requests starting with /v1/ to OpenAI handler', async () => {
    // Arrange
    const mockResponse = new Response('OpenAI Response', { status: 200 });
    OpenAI.mockResolvedValue(mockResponse);
    const request = new Request('https://gemini-proxy.com/v1/chat/completions');
    const env = { OPENAI_API_KEY: 'test-key' };

    // Act
    const response = await handleRequest(request, env);
    const text = await response.text();

    // Assert
    expect(OpenAI).toHaveBeenCalledWith(request, env);
    expect(response.status).toBe(200);
    expect(text).toBe('OpenAI Response');
  });
});
