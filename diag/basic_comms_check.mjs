
import { createClient } from '@vercel/kv';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function runDiagnostics() {
  let kv;
  let apiKey;

  // 1. Connect to KV and get a key
  try {
    console.log('Attempting to connect to Vercel KV...');
    if (!process.env.KV_URL || !process.env.KV_REST_API_TOKEN) {
        throw new Error('KV_URL and KV_REST_API_TOKEN environment variables must be set.');
    }
    kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    console.log('Successfully created Vercel KV client.');

    console.log('Scanning for a key in KV...');
    const [cursor, keys] = await kv.scan(0);

    if (keys.length === 0) {
      throw new Error('No keys found in Vercel KV store.');
    }
    const keyName = keys[0];
    console.log(`Found key: "${keyName}". Fetching its value...`);

    apiKey = await kv.get(keyName);

    if (!apiKey) {
      throw new Error(`Value for key '${keyName}' is null or empty.`);
    }
    console.log('Successfully retrieved API key from Vercel KV.');

  } catch (error) {
    console.error('--- KV CONNECTION/READ FAILED ---');
    console.error('Error:', error.message);
    if (error.stack) {
        console.error('Stack:', error.stack);
    }
    process.exit(1); // Exit with error
  }

  // 2. Make the API call
  try {
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    console.log(`Attempting to call Gemini API at: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
    });

    const responseData = await response.json();

    console.log('--- GEMINI API RESPONSE ---');
    if (!response.ok) {
        console.error(`API call failed with status: ${response.status}`);
    }
    console.log(JSON.stringify(responseData, null, 2));

  } catch (error) {
    console.error('--- GEMINI API CALL FAILED ---');
    console.error('Error:', error.message);
    if (error.stack) {
        console.error('Stack:', error.stack);
    }
    process.exit(1); // Exit with error
  }
}

runDiagnostics();
