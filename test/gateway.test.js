'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createGateway } = require('../src/gateway');
const env = { VERIFY_TOKEN: 'local-test-token', APP_SECRET: 'local-test-secret', OWNER_WHATSAPP_NUMBER: '96170000000', WHATSAPP_PHONE_NUMBER_ID: '123456' };
const event = (id = 'wamid.test', from = env.OWNER_WHATSAPP_NUMBER, phone = env.WHATSAPP_PHONE_NUMBER_ID) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, messages: [{ id, from, type: 'text', text: { body: 'test' } }] } }] }] });
async function setup(t, options = {}) {
  const server = createGateway({ env, checkDatabase: async () => true, readyTimeoutMs: 50, readyCacheMs: 0, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => fetch(base + path);
  const post = (body = event(), options = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return fetch(base + '/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', env.APP_SECRET).update(raw).digest('hex'), ...options } });
  };
  return { base, get, post };
}
test('exact challenge response with no surrounding text', async t => {
  const { get } = await setup(t);
  const response = await get('/webhook?hub.mode=subscribe&hub.verify_token=local-test-token&hub.challenge=1234');
  assert.equal(response.status, 200); assert.equal(await response.text(), '1234');
});
test('invalid, missing, duplicate verification inputs denied', async t => {
  const { get } = await setup(t);
  for (const query of [ 'hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1234', 'hub.mode=subscribe&hub.verify_token=local-test-token', 'hub.mode=subscribe&hub.verify_token=local-test-token&hub.challenge=', 'hub.mode=subscribe&hub.verify_token=local-test-token&hub.challenge=1&hub.challenge=2', 'hub.mode=wrong&hub.verify_token=local-test-token&hub.challenge=1']) assert.equal((await get('/webhook?' + query)).status, 403);
});
test('no token fails closed, alternate token name works', async t => {
  const a = await setup(t, { env: {} });
  assert.equal((await a.get('/webhook?hub.mode=subscribe&hub.challenge=1')).status, 503);
  const b = await setup(t, { env: { WHATSAPP_CLOUD_VERIFY_TOKEN: 'alternate' } });
  const r = await b.get('/webhook?hub.mode=subscribe&hub.verify_token=alternate&hub.challenge=1');
  assert.equal(r.status, 200); assert.equal(await r.text(), '1');
});
test('health minimal, readiness honest, unknown routes and methods rejected', async t => {
  const { get, base } = await setup(t);
  const health = await (await get('/healthz')).json();
  assert.deepEqual(health, { status: 'ok', version: '2.0.0', commit: 'unknown' });
  const ready = await get('/readyz');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', database_ready: true, webhook_configured: true, processing_enabled: false });
  assert.equal((await get('/')).status, 404);
  assert.equal((await fetch(base + '/webhook', { method: 'PUT' })).status, 405);
  assert.equal((await fetch(base + '/healthz', { method: 'POST' })).status, 405);
});
test('database unavailable returns 503 while health remains independent', async t => {
  let checks = 0;
  const { get } = await setup(t, { checkDatabase: async () => { checks++; return false; } });
  const health = await get('/healthz');
  assert.equal(health.status, 200); assert.equal(checks, 0);
  const ready = await get('/readyz');
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'not_ready', database_ready: false, webhook_configured: true, processing_enabled: false });
  assert.equal(checks, 1);
});
test('default database readiness timeout allows checks slower than three seconds', async t => {
  const { get } = await setup(t, { readyTimeoutMs: undefined, checkDatabase: async () => {
    await new Promise(resolve => setTimeout(resolve, 3100));
    return true;
  } });
  const ready = await get('/readyz');
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).database_ready, true);
});
test('database readiness timeout returns 503', async t => {
  const { get } = await setup(t, { checkDatabase: () => new Promise(() => {}), readyTimeoutMs: 10 });
  const ready = await get('/readyz');
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).database_ready, false);
});
test('database readiness failure never leaks secret details', async t => {
  const secret = 'postgresql://private-user:private-password@private-host/db';
  const { get } = await setup(t, { checkDatabase: async () => { throw new Error(secret); } });
  const ready = await get('/readyz');
  const body = await ready.text();
  assert.equal(ready.status, 503);
  assert.ok(!body.includes(secret));
  assert.ok(!body.includes('private-password'));
});
test('concurrent readiness requests share one short-lived database check', async t => {
  let checks = 0;
  const { get } = await setup(t, { readyCacheMs: 1000, checkDatabase: async () => { checks++; await new Promise(resolve => setTimeout(resolve, 10)); return true; } });
  const responses = await Promise.all([get('/readyz'), get('/readyz'), get('/readyz')]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(checks, 1);
});
test('valid signed messages return 503 without processor, not false success', async t => {
  const { post } = await setup(t);
  const r = await post(); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'processing_disabled');
});
test('signature and secret required, tampered payload rejected', async t => {
  const { post } = await setup(t);
  assert.equal((await post(event(), { 'x-hub-signature-256': '' })).status, 401);
  assert.equal((await post(event(), { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).status, 401);
  const missing = await setup(t, { env: { ...env, APP_SECRET: '' } });
  assert.equal((await missing.post()).status, 503);
});
test('JSON syntax, shape, content type, size are enforced', async t => {
  const { post } = await setup(t, { maxBytes: 512 });
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post(event(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('x'.repeat(1024))).status, 413);
});
test('owner and phone filters run before processing entire batch', async t => {
  let count = 0;
  const { post, get } = await setup(t, { handleEvent: async () => { count++; } });
  const ready = await get('/readyz');
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).processing_enabled, true);
  assert.equal((await post(event('id1', '96171111111'))).status, 403);
  assert.equal((await post(event('id1', env.OWNER_WHATSAPP_NUMBER, 'wrong'))).status, 403);
  const mixed = event(); mixed.entry[0].changes[0].value.messages.push({ id: 'other', from: '96171111111', type: 'text' });
  assert.equal((await post(mixed)).status, 403); assert.equal(count, 0);
});
test('signed status-only callbacks acknowledged without agent', async t => {
  const { post } = await setup(t); const body = event(); const v = body.entry[0].changes[0].value;
  delete v.messages; v.statuses = [{ id: 'sent-id', status: 'delivered' }];
  assert.equal((await post(body)).status, 200);
});
test('concurrent duplicate event handled once', async t => {
  let count = 0;
  const { post } = await setup(t, { handleEvent: async () => { count++; await new Promise(resolve => setTimeout(resolve, 20)); } });
  const responses = await Promise.all([post(), post(), post()]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(count, 1);
});
test('failed processor returns 503 and allows retry', async t => {
  let count = 0;
  const { post } = await setup(t, { handleEvent: async () => { if (++count === 1) throw new Error('private detail'); } });
  const failed = await post(); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private detail'));
  assert.equal((await post()).status, 200); assert.equal(count, 2);
});
test('deduplication bounded capacity fails closed then recovers after TTL', async t => {
  let clock = 100, count = 0;
  const { post } = await setup(t, { maxSeen: 1, ttlMs: 10, now: () => clock, handleEvent: async () => { count++; } });
  assert.equal((await post(event('a'))).status, 200);
  assert.equal((await post(event('a'))).status, 200);
  assert.equal((await post(event('b'))).status, 503); assert.equal(count, 1);
  clock += 11;
  assert.equal((await post(event('b'))).status, 200); assert.equal(count, 2);
});
