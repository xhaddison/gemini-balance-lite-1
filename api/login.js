export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response(`Method ${request.method} Not Allowed`, {
        status: 405,
        headers: {
          'Allow': 'POST',
        },
      });
    }

    try {
      const { key } = await request.json();
      const adminKey = env.ADMIN_LOGIN_KEY;

      if (!adminKey) {
        console.error('ADMIN_LOGIN_KEY is not set in environment variables.');
        return new Response(JSON.stringify({ success: false, message: 'Server configuration error.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (key && key === adminKey) {
        return new Response(JSON.stringify({ success: true, message: 'Login successful' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ success: false, message: 'Invalid key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      console.error('Error processing login request:', error);
      if (error instanceof SyntaxError) {
         return new Response(JSON.stringify({ success: false, message: 'Invalid JSON body.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: false, message: 'An unexpected error occurred.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
