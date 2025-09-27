// api/keys.js
import { getAllKeys, addKey, deleteKey, verifyAdminKey } from '../src/key_manager.js';


const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

export default {
  
  async fetch(request, env, ctx) {

    // Compatibility layer that merges worker env and process.env, with worker env taking precedence.
    const envWrapper = {
      ...(typeof process !== 'undefined' ? process.env : {}),
      ...env,
    };

    if (!verifyAdminKey(request, envWrapper)) {
      return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
    }

    try {
      switch (request.method) {
        case 'GET': {
          const keys = await getAllKeys(envWrapper);
          return jsonResponse({ success: true, keys });
        }

        case 'POST': {
          const { key: newKey } = await request.json();
          if (!newKey) {
            return jsonResponse({ success: false, message: 'Bad Request: "key" is required.' }, 400);
          }
          const addResult = await addKey(newKey, envWrapper);
          return jsonResponse(addResult, addResult.success ? 201 : 400);
        }

        case 'DELETE': {
          const { key: keyToDelete } = await request.json();
          if (!keyToDelete) {
            return jsonResponse({ success: false, message: 'Bad Request: "key" is required.' }, 400);
          }
          const deleteResult = await deleteKey(keyToDelete, envWrapper);
          return jsonResponse(deleteResult, deleteResult.success ? 200 : 404);
        }

        default:
          return new Response(`Method ${request.method} Not Allowed`, {
            status: 405,
            headers: { 'Allow': 'GET, POST, DELETE' },
          });
      }
    } catch (error) {
       console.error(`[API /api/keys] Error during ${request.method} request:`, error);
      if (error instanceof SyntaxError) {
        return jsonResponse({ success: false, message: 'Invalid JSON body.' }, 400);
      }
      return jsonResponse({ success: false, message: 'Internal Server Error' }, 500);
    }
  },
};
