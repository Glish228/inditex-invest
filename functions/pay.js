// functions/pay.js — Cloudflare Pages Function
// Redirige vers BKApay pour un dépôt
// URL : /functions/pay?amount=5000&user_id=xxx

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const amount  = searchParams.get('amount');
  const user_id = searchParams.get('user_id');

  if (!amount || isNaN(Number(amount)) || Number(amount) < 200) {
    return new Response(JSON.stringify({ error: 'Montant invalide (min 200 F).' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const BKA_PUBLIC_KEY = 'pk_live_241f9c02-81db-4c7a-ac24-7f5a7633daac';
  const baseUrl        = new URL(context.request.url).origin;
  const callback       = encodeURIComponent(`${baseUrl}/deposit-callback.html`);
  const desc           = encodeURIComponent('Dépôt Inditex Invest');

  const bkaUrl =
    `https://bkapay.com/api-pay/${BKA_PUBLIC_KEY}` +
    `?amount=${amount}&description=${desc}&callback=${callback}`;

  return Response.redirect(bkaUrl, 302);
}