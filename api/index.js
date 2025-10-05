export default function handler(request, response) {
  response.status(200).json({
    message: 'Hello from the root!',
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
}
