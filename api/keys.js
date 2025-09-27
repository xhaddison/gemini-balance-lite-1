// api/keys.js
import { getAllKeys, addKey, deleteKey } from '../src/key_manager.js';

// Middleware for admin authentication
const authenticate = (req) => {
  const authKey = req.headers.authorization;
  if (!authKey || authKey !== process.env.ADMIN_LOGIN_KEY) {
    return false;
  }
  return true;
};

export default async function handler(req, res) {
  if (!authenticate(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    switch (req.method) {
      case 'GET':
        const keys = await getAllKeys();
        return res.status(200).json({ success: true, keys });

      case 'POST':
        const { key: newKey } = req.body;
        if (!newKey) {
          return res.status(400).json({ success: false, message: 'Bad Request: "key" is required.' });
        }
        const addResult = await addKey(newKey);
        return res.status(addResult.success ? 201 : 400).json(addResult);

      case 'DELETE':
        const { key: keyToDelete } = req.body;
        if (!keyToDelete) {
          return res.status(400).json({ success: false, message: 'Bad Request: "key" is required.' });
        }
        const deleteResult = await deleteKey(keyToDelete);
        return res.status(deleteResult.success ? 200 : 404).json(deleteResult);

      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`[API /api/keys] Error during ${req.method} request:`, error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}
