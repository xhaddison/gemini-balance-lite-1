// /Users/addison/repository/gemini-balance-lite/src/openai.test.js

// Mock the global fetch function before all tests
global.fetch = jest.fn();

// Dynamically import the module to be tested
const { OpenAI } = await import('./openai.mjs');

describe('OpenAI Module', () => {

  beforeEach(() => {
    // Clear mock history before each test
    fetch.mockClear();
  });

  test('should attempt a request and handle a successful response', async () => {
    // Mock a successful API response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Success' } }] }),
    });

    const request = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    };

    // We expect this call to succeed without crashing
    const response = await OpenAI(request);

    // Verify the response
    expect(response.choices[0].message.content).toBe('Success');
    // Verify that fetch was called
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('should trigger the fatal crash when fetch fails unexpectedly', async () => {
    // Mock a catastrophic failure in fetch
    fetch.mockRejectedValueOnce(new Error('Network failure'));

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
