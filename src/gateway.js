'use strict';
const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { version } = require('../package.json');
function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
function createGateway(options = {}) {
  const env = options.env || process.env;
  const verifyToken = env.VERIFY_TOKEN || env.WHATSAPP_CLOUD_VERIFY_TOKEN || '';
  const appSecret = env.APP_SECRET || '';
  const owner = env.OWNER_WHATSAPP_NUMBER || '';
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID || '';
  const handleEvent = options.handleEvent;
  const maxBytes = options.maxBytes || 256 * 1024;
  const ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
  const maxSeen = options.maxSeen || 10000;
  const now = options.now || Date.now;
  const seen = new Map();
  const commit = /^[a-f0-9]{7,40}$/i.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : 'unknown';
  const webhookConfigured = () => Boolean(verifyToken && appSecret && /^\d{7,15}$/.test(owner) && /^\d+$/.test(phoneId));
  const processingEnabled = () => typeof handleEvent === 'function';
  const ready = () => true;
  function reply(res, code, value, plain = false) {
    res.writeHead(code, { 'Content-Type': plain ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(plain ? value : JSON.stringify(value));
  }
  async function dispatch(event) {
    for (const [id, item] of seen) if (item.done && item.until <= now()) seen.delete(id);
    const key = event.message.id;
    if (seen.has(key)) return seen.get(key).promise;
    if (seen.size >= maxSeen) throw new Error('capacity');
    const record = { done: false, until: Infinity };
    record.promise = Promise.resolve().then(() => handleEvent(event));
    seen.set(key, record);
    try { await record.promise; record.done = true; record.until = now() + ttlMs; }
    catch (error) { seen.delete(key); throw error; }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz' || url.pathname === '/readyz') {
        if (req.method !== 'GET') return reply(res, 405, { error: 'method_not_allowed' });
        if (url.pathname === '/healthz') return reply(res, 200, { status: 'ok', version, commit });
        return reply(res, ready() ? 200 : 503, {
          status: ready() ? 'ready' : 'not_ready',
          database_verified_at_startup: true,
          webhook_configured: webhookConfigured(),
          processing_enabled: processingEnabled()
        });
      }
      if (url.pathname !== '/webhook') return reply(res, 404, { error: 'not_found' });
      if (req.method === 'GET') {
        if (!verifyToken) return reply(res, 503, 'Verification unavailable', true);
        const get = key => url.searchParams.getAll(key);
        const mode = get('hub.mode'), token = get('hub.verify_token'), challenge = get('hub.challenge');
        if (mode.length !== 1 || token.length !== 1 || challenge.length !== 1 || mode[0] !== 'subscribe' || !equal(token[0], verifyToken) || !challenge[0] || challenge[0].length > 1024) return reply(res, 403, 'Forbidden', true);
        return reply(res, 200, challenge[0], true);
      }
      if (req.method !== 'POST') return reply(res, 405, { error: 'method_not_allowed' });
      if (!appSecret) return reply(res, 503, { error: 'webhook_unavailable' });
      const signature = req.headers['x-hub-signature-256'];
      if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return reply(res, 401, { error: 'invalid_signature' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'json_required' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) { reply(res, 413, { error: 'payload_too_large' }); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
      if (!equal(signature.toLowerCase(), expected)) return reply(res, 401, { error: 'invalid_signature' });
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { return reply(res, 400, { error: 'invalid_json' }); }
      if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry) || !body.entry.length) return reply(res, 400, { error: 'invalid_event' });
      if (!webhookConfigured()) return reply(res, 503, { error: 'webhook_unavailable' });
      const events = [];
      let statuses = 0;
      for (const entry of body.entry) {
        if (!entry || !Array.isArray(entry.changes) || !entry.changes.length) return reply(res, 400, { error: 'invalid_event' });
        for (const change of entry.changes) {
          const value = change && change.value;
          if (change?.field !== 'messages' || !value || value.messaging_product !== 'whatsapp') return reply(res, 400, { error: 'invalid_event' });
          if (value.metadata?.phone_number_id !== phoneId) return reply(res, 403, { error: 'unauthorized_event' });
          if (value.statuses !== undefined) {
            if (!Array.isArray(value.statuses) || !value.statuses.every(s => s && typeof s.id === 'string' && typeof s.status === 'string')) return reply(res, 400, { error: 'invalid_event' });
            statuses += value.statuses.length;
          }
          if (value.messages !== undefined) {
            if (!Array.isArray(value.messages)) return reply(res, 400, { error: 'invalid_event' });
            for (const message of value.messages) {
              if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 512 || typeof message.type !== 'string') return reply(res, 400, { error: 'invalid_event' });
              if (message.from !== owner) return reply(res, 403, { error: 'unauthorized_event' });
              events.push({ message, metadata: { phone_number_id: phoneId } });
              if (events.length > 100) return reply(res, 413, { error: 'too_many_events' });
            }
          }
        }
      }
      if (!events.length && !statuses) return reply(res, 400, { error: 'invalid_event' });
      if (events.length && typeof handleEvent !== 'function') return reply(res, 503, { error: 'processing_disabled' });
      for (const event of events) await dispatch(event);
      return reply(res, 200, { status: 'accepted' });
    } catch {
      if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'temporarily_unavailable' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.timeout = 20000;
  server.maxHeadersCount = 50;
  return server;
}
function start() {
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createGateway();
  server.listen(port, '0.0.0.0', () => console.log(`Super Sami webhook gateway listening on ${port}; agent processing disabled`));
  const stop = () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return server;
}
module.exports = { createGateway, start };
