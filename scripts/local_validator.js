
import 'dotenv/config';
import { Redis } from '@upstash/redis';
import https from 'https';

const KEY_SET = 'gemini_keys_set';

// 1. Connect to Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function main() {
  console.log('Attempting to fetch a random API key from Upstash Redis...');

  // 2. Fetch one random API key
  const apiKey = await redis.srandmember(KEY_SET);

  // 3. If no key is found, exit
  if (!apiKey) {
    console.error('Error: No API key found in the `gemini_keys_set`. Please add keys to the Redis set.');
    process.exit(1);
  }

  console.log(`Successfully fetched an API key.`);

  // 4. Prepare the Google Gemini API call with a VALID model
  const model = 'gemini-2.5-flash'; // Use a valid model from the listModels endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const postData = JSON.stringify({
    contents: [{ parts: [{ text: 'Hello' }] }],
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey, // API key passed as a header
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  // 5. Print request details
  console.log(`\nRequesting URL: ${url}`);
  console.log(`Using API Key (first 8 chars): ${apiKey.substring(0, 8)}...`);

  const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const jsonResponse = JSON.parse(data);
        if (res.statusCode >= 400) {
             console.error('\nError Response from Gemini API:');
             console.error(JSON.stringify(jsonResponse, null, 2));
        } else {
             console.log('\nSuccessful Response from Gemini API:');
             console.log(JSON.stringify(jsonResponse, null, 2));
        }
      } catch (e) {
        console.error('\nFailed to parse JSON response:');
        console.error(data);
      }
    });
  });

  req.on('error', (e) => {
    console.error('\nDetailed Error Object:');
    console.error(e);
  });

  req.write(postData);
  req.end();
}

main();
