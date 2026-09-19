const http = require('http');
const hermes = require('./hermes');
const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = 'sami_super_bot_2026';

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // 1. رابط التثبت التلقائي من الواتساب (GET /webhook)
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

  // 2. استلام رسائل الزباين والطلبات (POST /webhook)
  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const reply = await hermes.handleIncomingMessage(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', reply }));
      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ignored' }));
      }
    });
    return;
  }

  // الصفحة الرئيسية للسيرفر
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Super Sami & Hermes WhatsApp Engine: Active and Ready!');
}).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
