// functions/webhook.js — Cloudflare Pages Function
// Pas d'import npm — utilise l'API REST Supabase via fetch

const SUPABASE_URL      = 'https://oxwvofgenucbebcbiztc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94d3ZvZmdlbnVjYmViY2JpenRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDQ1MDEsImV4cCI6MjEwNzU4MDUwMX0.SoP6W2GWr9Oir1TamKmqskFzeGNFPAI2gWrIcJtnvmY';
const WEBHOOK_SECRET    = 'cs_525b3730f0a5498eb68c4b037b823858';

const HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal'
};

export async function onRequestPost(context) {
  try {
    const body      = await context.request.text();
    const signature = context.request.headers.get('x-bkapay-signature') || '';

    // Vérification signature HMAC-SHA256
    const encoder = new TextEncoder();
    const key     = await crypto.subtle.importKey(
      'raw', encoder.encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac      = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (!timingSafeEqual(expected, signature)) {
      return new Response('Signature invalide', { status: 401 });
    }

    const payload = JSON.parse(body);
    if (payload.status !== 'completed') {
      return new Response('OK', { status: 200 });
    }

    const transactionId = payload.transactionId || payload.transaction_id;
    const amount        = Number(payload.amount);
    if (!transactionId || !amount) {
      return new Response('Données manquantes', { status: 400 });
    }

    // Idempotence — déjà traité ?
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deposits?payment_ref=eq.${transactionId}&select=id`,
      { headers: HEADERS }
    );
    const existing = await checkRes.json();
    if (existing.length > 0) {
      return new Response('Déjà traité', { status: 200 });
    }

    // Retrouver user_id depuis la description "Dépôt Inditex|USER_ID"
    const description = payload.description || '';
    const userId      = description.split('|')[1];
    if (!userId) {
      return new Response('user_id manquant', { status: 400 });
    }

    // Lire le portefeuille
    const walletRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}&select=deposit_balance`,
      { headers: HEADERS }
    );
    const wallets = await walletRes.json();
    if (!wallets.length) {
      return new Response('Portefeuille introuvable', { status: 404 });
    }

    const newBalance = Number(wallets[0].deposit_balance) + amount;

    // Mettre à jour le portefeuille
    await fetch(
      `${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}`,
      {
        method:  'PATCH',
        headers: HEADERS,
        body:    JSON.stringify({ deposit_balance: newBalance, updated_at: new Date() })
      }
    );

    // Enregistrer le dépôt
    await fetch(`${SUPABASE_URL}/rest/v1/deposits`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({
        user_id:     userId,
        amount,
        payment_ref: transactionId,
        status:      'completed'
      })
    });

    // Logger la transaction
    await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({
        user_id: userId,
        type:    'deposit',
        amount,
        wallet:  'deposit',
        status:  'completed',
        note:    'Dépôt Mobile Money (webhook)'
      })
    });

    return new Response('OK', { status: 200 });

  } catch (err) {
    return new Response('Erreur serveur : ' + err.message, { status: 500 });
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}