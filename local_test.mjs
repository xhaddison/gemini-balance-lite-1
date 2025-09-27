// local_test.mjs
import assert from 'assert';
import { addKey, getAllKeys, deleteKey } from './src/key_manager.js';

async function runTest() {
  // 1. Mock the Cloudflare environment object
  const mockEnv = {
    UPSTASH_REDIS_REST_URL: "redis://127.0.0.1:6379",
    UPSTASH_REDIS_REST_TOKEN: "local_token"
  };

  const testKey = `test_key_${Date.now()}_${'a'.repeat(31)}`;

  console.log('Running local integration test...');

  try {
    // 2. Test addKey
    console.log(`Attempting to add key: ${testKey}`);
    const addResult = await addKey(testKey, mockEnv);
    assert.strictEqual(addResult.success, true, 'addKey should return success: true');
    console.log('✅ addKey successful.');

    // 3. Test getAllKeys
    console.log('Attempting to get all keys...');
    const allKeys = await getAllKeys(mockEnv);
    assert.ok(allKeys.includes(testKey), 'getAllKeys should include the newly added key');
    console.log('✅ getAllKeys successful.');

    // 4. Test deleteKey
    console.log(`Attempting to delete key: ${testKey}`);
    const deleteResult = await deleteKey(testKey, mockEnv);
    assert.strictEqual(deleteResult.success, true, 'deleteKey should return success: true');
    console.log('✅ deleteKey successful.');

    // 5. Verify deletion
    console.log('Verifying key deletion...');
    const keysAfterDelete = await getAllKeys(mockEnv);
    assert.ok(!keysAfterDelete.includes(testKey), 'getAllKeys should not include the deleted key');
    console.log('✅ Verification successful.');

    console.log('\n🎉 All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);
    process.exit(1); // Exit with a non-zero code to indicate failure
  }
}

runTest();
