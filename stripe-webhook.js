import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PLAN_MAP = {
  'price_1TA4qXR2e0d2U3LoeVr0L3Oc': 'basic',
  'price_1TA4zpR2e0d2U3LoZUqRXOB0': 'basic',
  'price_1TA4qmR2e0d2U3Lo3OuQZCOp': 'professional',
  'price_1TA4xSR2e0d2U3LokhPIWKQS': 'professional',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const priceId = session.line_items?.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'basic';

      if (email) {
        const { error } = await sb.from('profiles').update({
          plan,
          stripe_customer_id: session.customer,
          plan_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }).eq('email', email);

        if (error) console.error('Supabase update error:', error);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const { error } = await sb.from('profiles').update({ plan: 'free' })
        .eq('stripe_customer_id', sub.customer);

      if (error) console.error('Supabase update error:', error);
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const priceId = sub.items?.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'basic';

      const { error } = await sb.from('profiles').update({ plan })
        .eq('stripe_customer_id', sub.customer);

      if (error) console.error('Supabase update error:', error);
    }

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.status(200).json({ received: true });
}
