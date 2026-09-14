// Stripe webhook -> Supabase subscription state + payment ledger.
// Served by server.js at POST /api/stripe-webhook (Railway). The Vercel-style
// function this replaces (api/stripe-webhook.js) was never reachable: the
// Railway server refuses every /api/ path, so Stripe got a 404.
//
// Environment (Railway service variables — never commit values):
//   STRIPE_WEBHOOK_SECRET  whsec_... from the Stripe endpoint
//   SUPABASE_URL           https://<ref>.supabase.co
//   SUPABASE_SERVICE_KEY   service-role key: the webhook is the only writer of
//                          subscription state (users cannot write it; see
//                          migration profiles_access_columns_server_only)
//
// Guarantees:
//   - the signature is checked over the RAW body, before anything is parsed;
//   - every event is recorded in stripe_events before it is applied, so a
//     redelivery is recognised and not applied twice;
//   - any failure to write returns 500, so Stripe retries -- the old handler
//     logged database errors and answered 200, losing the event for good;
//   - an event older than the last one applied to a customer is ignored, so a
//     late "updated" cannot resurrect a cancelled subscription;
//   - statuses are mapped onto the ones profiles accepts (active | inactive):
//     writing Stripe's own "canceled" / "past_due" was rejected by the table's
//     check constraint, which left cancelled subscribers with access.
'use strict';
const crypto = require('crypto');

const MAX_BYTES = 1024 * 1024;
const TOLERANCE_S = 300;

function readRaw(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// signed_payload = `${t}.${rawBody}`; any v1 = HMAC-SHA256(secret, signed_payload)
function verifySignature(raw, header, secret, now = Date.now() / 1000) {
  if (!header || !secret) return false;
  let t = null;
  const v1 = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    if (k === 'v1') v1.push(v);
  }
  if (!t || !v1.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(now - Number(t)) > TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return v1.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

function makeDb(url, key, fetchImpl = fetch) {
  const base = String(url || '').replace(/\/$/, '');
  return async function db(path, method, body, prefer) {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} -> ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
const status = (s) => (s === 'active' || s === 'trialing' ? 'active' : 'inactive');

// Stripe price -> plan, carried over from the earlier handler. A price not in
// the map leaves the stored plan as it is rather than guessing one.
const PLAN_MAP = {
  price_1TA4qXR2e0d2U3LoeVr0L3Oc: 'basic',
  price_1TA4zpR2e0d2U3LoZUqRXOB0: 'basic',
  price_1TA4qmR2e0d2U3Lo3OuQZCOp: 'professional',
  price_1TA4xSR2e0d2U3LokhPIWKQS: 'professional',
};
function planOf(priceId) {
  const p = PLAN_MAP[priceId];
  return p ? { plan: p, subscription_plan: p } : {};
}

// One event -> the profile change it implies. Returns what was done.
async function apply(db, event) {
  const o = (event.data && event.data.object) || {};
  const at = iso(event.created);
  // Only rows whose last applied Stripe state is older than this event.
  const fresh = `or=(stripe_state_at.is.null,stripe_state_at.lt.${encodeURIComponent(at)})`;
  const ledger = (fields) => db('payment_events?on_conflict=stripe_event_id', 'POST',
    { stripe_event_id: event.id, type: event.type, raw: { livemode: event.livemode, created: event.created }, ...fields },
    'resolution=ignore-duplicates,return=minimal');
  let rows = [];
  switch (event.type) {
    case 'checkout.session.completed': {
      const user = o.client_reference_id || null;
      const email = (o.customer_details && o.customer_details.email) || o.customer_email || null;
      const target = user ? `id=eq.${encodeURIComponent(user)}` : email ? `email=eq.${encodeURIComponent(email)}` : null;
      if (target) {
        // The session carries no line items unless expanded, so the plan is
        // settled by the invoice that follows; the subscription is live now.
        rows = await db(`profiles?${target}&${fresh}`, 'PATCH', {
          subscription_status: 'active', stripe_customer_id: o.customer || null, stripe_state_at: at,
        }, 'return=representation');
      }
      await ledger({ amount_cents: o.amount_total ?? null, currency: o.currency || null, customer_id: o.customer || null,
                     email, user_id: user });
      return { matched: rows.length,
               note: !target ? 'no user reference or email on the session'
                     : rows.length ? null : 'no profile matched, or a newer state is already applied' };
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const line = o.lines && o.lines.data && o.lines.data[0];
      const end = line && line.period ? iso(line.period.end) : null;
      const plan = planOf(line && line.price && line.price.id);
      if (o.customer) {
        rows = await db(`profiles?stripe_customer_id=eq.${encodeURIComponent(o.customer)}&${fresh}`, 'PATCH',
          { subscription_status: 'active', ...plan, ...(end ? { plan_expires_at: end } : {}), stripe_state_at: at },
          'return=representation');
      }
      await ledger({ amount_cents: o.amount_paid ?? null, currency: o.currency || null, customer_id: o.customer || null,
                     email: o.customer_email || null, plan: plan.plan || null });
      return { matched: rows.length };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const deleted = event.type.endsWith('deleted');
      const patch = deleted
        ? { plan: 'free', subscription_plan: 'free', subscription_status: 'inactive',
            plan_expires_at: iso(o.ended_at) || at, stripe_state_at: at }
        : { subscription_status: status(o.status),
            ...planOf(o.items && o.items.data && o.items.data[0] && o.items.data[0].price && o.items.data[0].price.id),
            ...(o.current_period_end ? { plan_expires_at: iso(o.current_period_end) } : {}), stripe_state_at: at };
      if (o.customer) {
        rows = await db(`profiles?stripe_customer_id=eq.${encodeURIComponent(o.customer)}&${fresh}`, 'PATCH',
          patch, 'return=representation');
      }
      await ledger({ customer_id: o.customer || null, plan: deleted ? 'free' : null });
      return { matched: rows.length };
    }
    default:
      await ledger({ customer_id: o.customer || null });
      return { matched: 0, note: 'not a subscription event; ledgered only' };
  }
}

function makeHandler({ secret, db }) {
  return async function handle(req, res) {
    const reply = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
    // Unconfigured is a server fault, not the sender's: 503 makes Stripe retry.
    if (!secret || !db) return reply(503, { error: 'not configured' });
    let raw;
    try { raw = await readRaw(req); } catch (e) { return reply(e.status || 400, { error: e.message }); }
    if (!verifySignature(raw, req.headers['stripe-signature'], secret)) return reply(400, { error: 'invalid signature' });
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return reply(400, { error: 'invalid payload' }); }
    if (!event || !event.id || !event.type) return reply(400, { error: 'not an event' });

    const idq = `stripe_events?event_id=eq.${encodeURIComponent(event.id)}`;
    try {
      const ins = await db('stripe_events?on_conflict=event_id', 'POST',
        { event_id: event.id, type: event.type, created: iso(event.created) },
        'resolution=ignore-duplicates,return=representation');
      if (!ins || !ins.length) {
        const prev = await db(`${idq}&select=status`, 'GET');
        if (prev && prev[0] && (prev[0].status === 'processed' || prev[0].status === 'ignored')) {
          return reply(200, { received: true, duplicate: true });
        }
      }
    } catch (e) {
      console.error('stripe-webhook: could not record event', event.id, e.message);
      return reply(500, { error: 'could not record event' });
    }
    try {
      const done = await apply(db, event);
      await db(idq, 'PATCH', { status: done.matched || !done.note ? 'processed' : 'ignored',
                               processed_at: new Date().toISOString(), error: done.note || null });
      return reply(200, { received: true, ...done });
    } catch (e) {
      console.error('stripe-webhook: apply failed', event.id, e.message);
      try { await db(idq, 'PATCH', { status: 'failed', error: e.message.slice(0, 500) }); } catch { /* the 500 below still makes Stripe retry */ }
      return reply(500, { error: 'handler error' });
    }
  };
}

module.exports = { makeHandler, makeDb, verifySignature, apply, readRaw };
