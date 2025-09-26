export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { key } = req.body;
    const adminKey = process.env.ADMIN_LOGIN_KEY;

    if (!adminKey) {
      console.error('ADMIN_LOGIN_KEY is not set in environment variables.');
      return res.status(500).json({ success: false, message: 'Server configuration error.' });
    }

    if (key && key === adminKey) {
      return res.status(200).json({ success: true, message: 'Login successful' });
    } else {
      return res.status(401).json({ success: false, message: 'Invalid key' });
    }
  } catch (error) {
    console.error('Error processing login request:', error);
    return res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
}
