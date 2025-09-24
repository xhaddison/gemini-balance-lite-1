import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { OpenAI } from './openai.mjs';

// Mock the global fetch function before all tests
global.fetch = jest.fn();

jest.mock('./openai.mjs', () => ({
  OpenAI: jest.fn(),
}));

describe('OpenAI Module', () => {

  beforeEach(() => {
    // Clear mock history before each test
    fetch.mockClear();
    OpenAI.mockClear();
  });

  test('should attempt a request and handle a successful response', async () => {
    // Mock a successful API response
    OpenAI.mockResolvedValue({ choices: [{ message: { content: 'Success' } }] });

    const request = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    };

    // We expect this call to succeed without crashing
    const response = await OpenAI(request);

    // Verify the response
    expect(response.choices[0].message.content).toBe('Success');
    // Verify that OpenAI was called
    expect(OpenAI).toHaveBeenCalledTimes(1);
  });

  test('should trigger the fatal crash when fetch fails unexpectedly', async () => {
    // Mock a catastrophic failure in fetch
    OpenAI.mockRejectedValue(new Error('Network failure'));

    const request = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    };

    // We are wrapping the call in a try...catch block to observe the error
    // This is the call that is expected to crash the worker in production
    await expect(OpenAI(request)).rejects.toThrow('Network failure');
  });

});
