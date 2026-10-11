import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('SITE_ORIGIN') || '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const zeroDecimal = new Set(['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf']);
const threeDecimal = new Set(['bhd','jod','kwd','omr','tnd']);
function minorUnits(amount: number, currency: string) { const c=currency.toLowerCase(); return Math.round(amount * (zeroDecimal.has(c) ? 1 : threeDecimal.has(c) ? 1000 : 100)); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const siteUrl = Deno.env.get('SITE_URL');
  if (!stripeKey || !url || !serviceKey || !siteUrl) return json({ error: 'Payment provider secrets are not configured.' }, 503);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in before checkout.' }, 401);
  const admin = createClient(url, serviceKey);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: 'Your session is invalid or expired.' }, 401);
  let input: { bookingId?: string } = {};
  try { input = await req.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!input.bookingId) return json({ error: 'bookingId is required.' }, 400);

  const { data: booking, error: bookingError } = await admin.from('bookings').select('id,guest_id,host_id,status,payment_status,currency,subtotal,platform_fee,property_id').eq('id', input.bookingId).maybeSingle();
  if (bookingError || !booking) return json({ error: 'Booking not found.' }, 404);
  if (booking.guest_id !== user.id) return json({ error: 'Only the guest who requested this booking can pay.' }, 403);
  if (booking.status !== 'accepted') return json({ error: 'The host must accept the booking before checkout.' }, 409);
  if (booking.payment_status === 'paid') return json({ error: 'This booking is already paid.' }, 409);
  const { data: host } = await admin.from('profiles').select('stripe_connect_account_id').eq('id', booking.host_id).maybeSingle();
  if (!host?.stripe_connect_account_id) return json({ error: 'This host has not completed payout onboarding yet.' }, 409);

  // Totals come from the database, never from browser-supplied amounts. The 5% application fee is in the booking currency.
  const currency = String(booking.currency || 'USD').trim().toLowerCase();
  const amount = minorUnits(Number(booking.subtotal), currency);
  const fee = minorUnits(Number(booking.platform_fee), currency);
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(fee) || fee < 0 || fee >= amount) return json({ error: 'The saved booking amount is not valid for checkout.' }, 409);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${siteUrl}/?payment=success&booking_id=${booking.id}`);
  form.set('cancel_url', `${siteUrl}/?payment=cancelled&booking_id=${booking.id}`);
  form.set('client_reference_id', booking.id);
  form.set('metadata[booking_id]', booking.id);
  form.set('payment_intent_data[application_fee_amount]', String(fee));
  form.set('payment_intent_data[transfer_data][destination]', host.stripe_connect_account_id);
  form.set('payment_intent_data[metadata][booking_id]', booking.id);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', currency);
  form.set('line_items[0][price_data][unit_amount]', String(amount));
  form.set('line_items[0][price_data][product_data][name]', `Haven booking ${booking.id.slice(0, 8)}`);
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `haven-booking-${booking.id}` }, body: form });
  const session = await stripeRes.json();
  if (!stripeRes.ok) return json({ error: session?.error?.message || 'Payment provider rejected this checkout. Check country and currency support.' }, 400);
  const { error: saveError } = await admin.from('bookings').update({ payment_status: 'checkout_created', payment_provider: 'stripe', payment_reference: session.id }).eq('id', booking.id);
  if (saveError) return json({ error: 'Checkout was created but its reference could not be saved. Contact support before retrying.' }, 500);
  return json({ url: session.url, checkoutSessionId: session.id });
});
