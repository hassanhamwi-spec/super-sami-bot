const http = require('http');
const hermes = require('./hermes');
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      console.log('Received via Hermes Webhook:', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'Hermes Connected' }));
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Super Sami & Hermes Agent Engine: Active and Ready!');
  }
}).listen(PORT, () => {
  console.log(`Hermes Orchestrator listening on port ${PORT}`);
});
