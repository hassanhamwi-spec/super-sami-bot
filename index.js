const http = require('http');
const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = 'sami_super_bot_2026';

const server = http.createServer((req, res) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'success' }));
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Super Sami WhatsApp Engine: Active and Ready!');
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
