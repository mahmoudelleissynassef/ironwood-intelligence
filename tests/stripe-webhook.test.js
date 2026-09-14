// node --test tests/  — Stripe webhook: signature, idempotency, failure handling, status mapping.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { makeHandler, verifySignature } = require('../stripe-webhook');

const SECRET = 'whsec_test';
function sign(body, t = Math.floor(Date.now() / 1000), secret = SECRET) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
function request(body, headers = {}) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = headers;
  req.destroy = () => {};
  setImmediate(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
  return req;
}
function response() {
  const res = { code: null, body: null, headersSent: false };
  res.writeHead = (c) => { res.code = c; res.headersSent = true; };
  res.end = (b) => { res.body = b ? JSON.parse(b) : null; };
  return res;
}
// A fake PostgREST: stripe_events rows, profile patches, ledger inserts.
function fakeDb({ failPatch = false } = {}) {
  const events = new Map();
  const calls = [];
  const db = async (path, method, body) => {
    calls.push([method, path, body]);
    if (path.startsWith('stripe_events?on_conflict')) {
      if (events.has(body.event_id)) return [];
      events.set(body.event_id, { status: 'received' });
      return [{ event_id: body.event_id }];
    }
    if (path.startsWith('stripe_events?event_id=eq.') && method === 'GET') {
      const id = decodeURIComponent(path.split('eq.')[1].split('&')[0]);
      return events.has(id) ? [{ status: events.get(id).status }] : [];
    }
    if (path.startsWith('stripe_events?event_id=eq.') && method === 'PATCH') {
      const id = decodeURIComponent(path.split('eq.')[1]);
      events.set(id, { ...events.get(id), ...body });
      return null;
    }
    if (path.startsWith('profiles?') && method === 'PATCH') {
      if (failPatch) throw new Error('supabase PATCH profiles -> 503: unavailable');
      return [{ id: 'u1' }];
    }
    if (path.startsWith('payment_events')) return null;
    throw new Error('unexpected ' + method + ' ' + path);
  };
  return { db, calls, events };
}
const event = (type, object, id = 'evt_1', created = 1788000000) =>
  JSON.stringify({ id, type, created, livemode: false, data: { object } });

test('a bad or missing signature is refused before anything is read', async () => {
  const { db, calls } = fakeDb();
  const h = makeHandler({ secret: SECRET, db });
  const body = event('invoice.paid', { customer: 'cus_1' });
  const res = response();
  await h(request(body, { 'stripe-signature': sign(body, undefined, 'whsec_other') }), res);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(calls.length, 0);
});

test('the signature is over the raw bytes, not re-serialised JSON', () => {
  const body = '{"id": "evt_1",   "type": "x"}';
  const header = sign(body);
  assert.ok(verifySignature(Buffer.from(body), header, SECRET));
  assert.ok(!verifySignature(Buffer.from(JSON.stringify(JSON.parse(body))), header, SECRET));
  assert.ok(!verifySignature(Buffer.from(body), sign(body, 1000), SECRET), 'a stale timestamp is refused');
});

test('an event is applied once; a redelivery is recognised', async () => {
  const { db, calls } = fakeDb();
  const h = makeHandler({ secret: SECRET, db });
  const body = event('invoice.paid', { customer: 'cus_1', amount_paid: 9900, currency: 'usd',
    lines: { data: [{ period: { end: 1790000000 }, price: { id: 'price_1TA4qmR2e0d2U3Lo3OuQZCOp' } }] } });
  const r1 = response(); await h(request(body, { 'stripe-signature': sign(body) }), r1);
  const r2 = response(); await h(request(body, { 'stripe-signature': sign(body) }), r2);
  assert.strictEqual(r1.code, 200); assert.strictEqual(r1.body.matched, 1);
  assert.strictEqual(r2.code, 200); assert.strictEqual(r2.body.duplicate, true);
  const patches = calls.filter(([m, p]) => m === 'PATCH' && p.startsWith('profiles?'));
  assert.strictEqual(patches.length, 1, 'applied exactly once');
  assert.strictEqual(patches[0][2].plan, 'professional');
  assert.match(patches[0][1], /stripe_state_at\.lt\./, 'an older event cannot overwrite a newer state');
});

test('a database failure answers 500 so Stripe retries, and the retry applies it', async () => {
  const f = fakeDb({ failPatch: true });
  const h = makeHandler({ secret: SECRET, db: f.db });
  const body = event('customer.subscription.deleted', { customer: 'cus_1', ended_at: 1789000000 }, 'evt_2');
  const r1 = response(); await h(request(body, { 'stripe-signature': sign(body) }), r1);
  assert.strictEqual(r1.code, 500);
  assert.strictEqual(f.events.get('evt_2').status, 'failed');
  const ok = fakeDb();
  ok.events.set('evt_2', { status: 'failed' });          // the failed attempt is on record
  const h2 = makeHandler({ secret: SECRET, db: ok.db });
  const r2 = response(); await h2(request(body, { 'stripe-signature': sign(body) }), r2);
  assert.strictEqual(r2.code, 200);
  const patch = ok.calls.find(([m, p]) => m === 'PATCH' && p.startsWith('profiles?'));
  assert.deepStrictEqual([patch[2].subscription_status, patch[2].plan], ['inactive', 'free']);
});

test("Stripe's statuses are mapped onto the ones the table accepts", async () => {
  for (const [stripeStatus, stored] of [['active', 'active'], ['trialing', 'active'], ['past_due', 'inactive'],
                                        ['canceled', 'inactive'], ['unpaid', 'inactive']]) {
    const { db, calls } = fakeDb();
    const h = makeHandler({ secret: SECRET, db });
    const body = event('customer.subscription.updated', { customer: 'cus_1', status: stripeStatus }, 'evt_' + stripeStatus);
    const res = response(); await h(request(body, { 'stripe-signature': sign(body) }), res);
    const patch = calls.find(([m, p]) => m === 'PATCH' && p.startsWith('profiles?'));
    assert.strictEqual(patch[2].subscription_status, stored, stripeStatus);
  }
});

test('an unconfigured endpoint says so with 503 (retryable), never 200', async () => {
  const res = response();
  await makeHandler({ secret: '', db: null })(request('{}', {}), res);
  assert.strictEqual(res.code, 503);
});
