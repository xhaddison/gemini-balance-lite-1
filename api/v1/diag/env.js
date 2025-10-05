
export const config = {
  runtime: 'edge',
};

export default function handler(request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey.length > 0) {
      return new Response(
        JSON.stringify({
          status: 'success',
          key_found: true,
          key_length: apiKey.length,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          status: 'failure',
          key_found: false,
          message: 'GEMINI_API_KEY is not defined or empty.',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'An unexpected error occurred.',
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
        },
      }
    );
  }
}
