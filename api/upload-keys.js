
import { IntelligentKeyScheduler } from '../src/key_manager.js';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const form = formidable({});

  try {
    const [fields, files] = await form.parse(req);

    const adminKey = fields.admin_key?.[0];
    if (!adminKey || adminKey !== process.env.ADMIN_LOGIN_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid admin key.' });
    }

    const uploadedFile = files.keys_file?.[0];
    if (!uploadedFile) {
      return res.status(400).json({ success: false, message: 'Bad Request: No file uploaded.' });
    }

    const fileContent = await fs.promises.readFile(uploadedFile.filepath, 'utf8');
    const keys = fileContent.split(/[\s,]+/).filter(key => key.trim() !== '');

    if (keys.length === 0) {
      return res.status(400).json({ success: false, message: 'Bad Request: No keys found in the uploaded file.' });
    }

    const keyScheduler = IntelligentKeyScheduler.getInstance();
    await keyScheduler.setKeys(keys);
    await keyScheduler._saveState(); // Persist the new state

    return res.status(200).json({ success: true, message: `Successfully updated ${keys.length} keys.` });

  } catch (error) {
    console.error('Error processing file upload:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error: Could not process file upload.' });
  }
}
