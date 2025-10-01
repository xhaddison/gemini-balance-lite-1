
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import handler from '../src/index.js';

const PORT = 3000;

const convertNodeRequestToWeb = (nodeReq) => {
  const { headers, method, url } = nodeReq;
  const fullUrl = new URL(url, `http://${headers.host}`);

  const body = new ReadableStream({
    start(controller) {
      nodeReq.on('data', (chunk) => {
        controller.enqueue(chunk);
      });
      nodeReq.on('end', () => {
        controller.close();
      });
      nodeReq.on('error', (err) => {
        controller.error(err);
      });
    },
  });

  return new Request(fullUrl, {
    method,
    headers,
    body: (method !== 'GET' && method !== 'HEAD') ? body : null,
    duplex: 'half'
  });
};

const server = http.createServer(async (req, res) => {
  try {
    const webRequest = convertNodeRequestToWeb(req);
    const webResponse = await handler.fetch(webRequest, {});

    res.statusCode = webResponse.status;
    for (const [key, value] of webResponse.headers.entries()) {
      res.setHeader(key, value);
    }

    const buffer = await webResponse.arrayBuffer();
    res.end(Buffer.from(buffer));

  } catch (error) {
    console.error('Server error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
