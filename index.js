const http = require('http');
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Super Sami & Hermes Bot status: Active and Running!');
}).listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
