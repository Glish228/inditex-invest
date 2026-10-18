// functions/webhook.js — Cloudflare Pages Function
// Reçoit les notifications BKApay et crédite le portefeuille de dépôt
// URL à configurer dans BKApay : https://inditex-invest.pages.dev/functions/webhook

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://oxwvofgenucbebcbiztc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94d3ZvZmdlbnVjYmViY2JpenRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDQ1MDEsImV4cCI6MjEwNzU4MDUwMX0.SoP6W2GWr9Oir1TamKmqskFzeGNFPAI2gWrIcJtnvmY';
const WEBHOOK_SECRET   = 'cs_525b3730f0a5498eb68c4b037b823858';

export async function onRequestPost(context) {
  try {
    const body      = await context.request.text();
    const signature = context.request.headers.get('x-bkapay-signature') || '';

    // ── Vérification signature HMAC-SHA256 ─────────────────
    const encoder = new TextEncoder();
    const key     = await crypto.subtle.importKey(
      'raw', encoder.encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const mac      = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(mac))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    // Comparaison timing-safe
    if (expected.length !== signature.length ||
        !timingSafeEqual(expected, signature)) {
      return new Response('Signature invalide', { status: 401 });
    }

    const payload = JSON.parse(body);

    // ── Seulement les paiements complétés ──────────────────
    if (payload.status !== 'completed') {
      return new Response('OK', { status: 200 });
    }

    const transactionId = payload.transactionId || payload.transaction_id;
    const amount        = Number(payload.amount);

    if (!transactionId || !amount) {
      return new Response('Données manquantes', { status: 400 });
    }

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ── Idempotence : déjà traité ? ────────────────────────
    const { data: existing } = await db
      .from('deposits')
      .select('id')
      .eq('payment_ref', transactionId)
      .maybeSingle();

    if (existing) {
      return new Response('Déjà traité', { status: 200 });
    }

    // ── Retrouver l'utilisateur via la description ─────────
    // BKApay renvoie la description qu'on a passée à l'URL
    // On stocke le user_id dans la description : "Dépôt Inditex|USER_ID"
    const description = payload.description || '';
    const userId      = description.split('|')[1];

    if (!userId) {
      // Pas de user_id dans la description — on log et on passe
      console.error('Webhook: user_id manquant dans description:', description);
      return new Response('user_id manquant', { status: 400 });
    }

    // ── Créditer le portefeuille de dépôt ─────────────────
    const { data: wallet } = await db
      .from('wallets').select('deposit_balance')
      .eq('user_id', userId).single();

    if (!wallet) {
      return new Response('Portefeuille introuvable', { status: 404 });
    }

    const newBalance = Number(wallet.deposit_balance) + amount;

    await db.from('wallets')
      .update({ deposit_balance: newBalance, updated_at: new Date() })
      .eq('user_id', userId);

    await db.from('deposits').insert({
      user_id:     userId,
      amount,
      payment_ref: transactionId,
      status:      'completed'
    });

    await db.from('transactions').insert({
      user_id: userId,
      type:    'deposit',
      amount,
      wallet:  'deposit',
      status:  'completed',
      note:    'Dépôt Mobile Money (webhook)'
    });

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Erreur serveur', { status: 500 });
  }
}

// Comparaison en temps constant pour éviter timing attacks
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}