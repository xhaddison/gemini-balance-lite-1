import { getKeyManager } from '../src/key_manager.js';

export default async function handler(req, res) {
  try {
    const keyManager = await getKeyManager();
    await keyManager.resetDailyCounters();
    res.status(200).send('Key quotas reset successfully.');
  } catch (error) {
    console.error('Error resetting key quotas:', error);
    res.status(500).send('Internal Server Error.');
  }
}
