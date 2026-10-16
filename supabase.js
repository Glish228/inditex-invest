const SUPABASE_URL = 'https://oxwvofgenucbebcbiztc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94d3ZvZmdlbnVjYmViY2JpenRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDQ1MDEsImV4cCI6MjEwNzU4MDUwMX0.SoP6W2GWr9Oir1TamKmqskFzeGNFPAI2gWrIcJtnvmY';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AUTH ────────────────────────────────────────────────
async function registerUser(data) {
  let code = generateCode();
  let attempts = 0;
  while (attempts < 10) {
    const { data: existing } = await db
      .from('users').select('id').eq('referral_code', code).maybeSingle();
    if (!existing) break;
    code = generateCode();
    attempts++;
  }

  const { data: existingPhone } = await db
    .from('users').select('id')
    .eq('phone', data.phone).eq('country_code', data.country_code).maybeSingle();
  if (existingPhone) return { error: 'Ce numéro est déjà enregistré.' };

  const { data: user, error } = await db
    .from('users')
    .insert({
      phone: data.phone, country_code: data.country_code,
      full_name: data.full_name, password: data.password,
      referral_code: code, referred_by: data.referred_by || null
    })
    .select().single();
  if (error) return { error: 'Erreur inscription : ' + error.message };

  const { error: walletError } = await db
    .from('wallets').insert({ user_id: user.id });
  if (walletError) return { error: 'Erreur création portefeuille : ' + walletError.message };

  return { user };
}

async function loginUser(country_code, phone, password) {
  const { data: user, error } = await db
    .from('users').select('*')
    .eq('phone', phone).eq('country_code', country_code).eq('password', password)
    .maybeSingle();
  if (error || !user) return { error: 'Numéro ou mot de passe incorrect.' };
  if (user.is_frozen) return { error: 'Votre compte est suspendu. Contactez le support.' };
  return { user };
}

// ─── WALLET ──────────────────────────────────────────────
async function getWallet(user_id) {
  const { data, error } = await db
    .from('wallets').select('*').eq('user_id', user_id).single();
  if (error) return null;
  return data;
}

async function updateWallet(user_id, field, amount) {
  const wallet = await getWallet(user_id);
  if (!wallet) return { error: 'Portefeuille introuvable.' };
  const newBalance = Number(wallet[field]) + Number(amount);
  const { error } = await db
    .from('wallets')
    .update({ [field]: newBalance, updated_at: new Date() })
    .eq('user_id', user_id);
  if (error) return { error: error.message };
  return { success: true };
}

// ─── DÉPÔT BKApay ────────────────────────────────────────
const BKA_PUBLIC_KEY = 'pk_live_241f9c02-81db-4c7a-ac24-7f5a7633daac';

function redirectToDeposit(amount) {
  const callback = encodeURIComponent(window.location.origin + '/deposit-callback.html');
  const desc     = encodeURIComponent('Dépôt Inditex Invest');
  window.location.href =
    `https://bkapay.com/api-pay/${BKA_PUBLIC_KEY}?amount=${amount}&description=${desc}&callback=${callback}`;
}

async function confirmDeposit(user_id, transactionId, amount) {
  try {
    const res  = await fetch(`https://bkapay.com/api/inline-pay/status/${transactionId}`);
    const data = await res.json();

    if (data.status !== 'completed') return { error: 'Paiement non confirmé.' };
    if (Number(data.amount) !== Number(amount)) return { error: 'Montant invalide.' };

    // Idempotence : déjà traité ?
    const { data: existing } = await db
      .from('deposits').select('id').eq('payment_ref', transactionId).maybeSingle();
    if (existing) return { already: true };

    // Créditer portefeuille dépôt
    await updateWallet(user_id, 'deposit_balance', amount);
    await db.from('deposits').insert({
      user_id, amount, payment_ref: transactionId, status: 'completed'
    });
    await logTransaction(user_id, 'deposit', amount, 'deposit', 'completed', 'Dépôt Mobile Money');
    return { success: true };
  } catch (e) {
    return { error: 'Erreur vérification paiement.' };
  }
}

// ─── PLANS ───────────────────────────────────────────────
async function getPlans() {
  const { data, error } = await db
    .from('plans').select('*').eq('is_active', true)
    .order('price', { ascending: true });
  if (error) return [];
  return data;
}

async function getPlanDurations() {
  const { data, error } = await db
    .from('plan_durations').select('*').order('duration_days', { ascending: true });
  if (error) return [];
  return data;
}

async function getUserPlans(user_id) {
  const { data, error } = await db
    .from('user_plans').select('*, plans(*)')
    .eq('user_id', user_id).order('start_date', { ascending: false });
  if (error) return [];
  return data;
}

async function buyFixedPlan(user_id, plan) {
  // Déjà un plan fixe ?
  const { data: existing } = await db
    .from('user_plans').select('id')
    .eq('user_id', user_id).eq('type', 'fixed').maybeSingle();
  if (existing) return { error: 'Vous avez déjà le plan fixe.' };

  // Vérifier solde dépôt
  const wallet = await getWallet(user_id);
  if (!wallet || wallet.deposit_balance < plan.price) {
    return { error: 'Solde insuffisant. Déposez d\'abord des fonds.' };
  }

  // Débiter portefeuille dépôt
  const debit = await updateWallet(user_id, 'deposit_balance', -plan.price);
  if (debit.error) return { error: debit.error };

  const end_date = new Date();
  end_date.setDate(end_date.getDate() + 180);

  const { error } = await db.from('user_plans').insert({
    user_id, plan_id: plan.id, type: 'fixed',
    amount_paid: plan.price, start_date: new Date(), end_date
  });
  if (error) {
    await updateWallet(user_id, 'deposit_balance', plan.price); // remboursement
    return { error: error.message };
  }

  // Activer le compte
  await db.from('users').update({ is_active: true }).eq('id', user_id);

  // Bonus activation : 500 F → portefeuille retrait
  await updateWallet(user_id, 'withdrawal_balance', 500);
  await logTransaction(user_id, 'bonus_activation', 500, 'withdrawal', 'completed', 'Bonus activation compte');

  // Parrainage
  await handleReferralBonus(user_id, plan.price);

  return { success: true };
}

async function buyShortPlan(user_id, plan, duration_days, gain_percent) {
  if (!await isAccountActive(user_id)) {
    return { error: 'Activez votre compte avec le plan fixe d\'abord.' };
  }

  // Vérifier solde dépôt
  const wallet = await getWallet(user_id);
  if (!wallet || wallet.deposit_balance < plan.price) {
    return { error: 'Solde insuffisant. Déposez d\'abord des fonds.' };
  }

  // Vérifier si c'est le premier plan court AVANT l'achat
  const { count: shortCount } = await db
    .from('user_plans').select('id', { count: 'exact' })
    .eq('user_id', user_id).eq('type', 'short');
  const isFirst = shortCount === 0;

  // Débiter portefeuille dépôt
  const debit = await updateWallet(user_id, 'deposit_balance', -plan.price);
  if (debit.error) return { error: debit.error };

  const gain_total = plan.price * (gain_percent / 100) + Number(plan.price);
  const end_date   = new Date();
  end_date.setDate(end_date.getDate() + duration_days);

  const { error } = await db.from('user_plans').insert({
    user_id, plan_id: plan.id, type: 'short',
    amount_paid: plan.price, gain_total,
    start_date: new Date(), end_date
  });
  if (error) {
    await updateWallet(user_id, 'deposit_balance', plan.price); // remboursement
    return { error: error.message };
  }

  // Bonus premier plan court uniquement
  if (isFirst) {
    // 3 000, 5 000, 10 000 F → 1 000 F ; 15 000 F et plus → 1 500 F
    const bonus = plan.price <= 10000 ? 1000 : 1500;
    await updateWallet(user_id, 'withdrawal_balance', bonus);
    await logTransaction(
      user_id, 'bonus_first_short', bonus, 'withdrawal', 'completed',
      `Bonus premier plan court (${formatMoney(plan.price)})`
    );
  }

  return { success: true };
}

// ─── PARRAINAGE ──────────────────────────────────────────
async function handleReferralBonus(user_id, amount) {
  const { data: user } = await db
    .from('users').select('referred_by').eq('id', user_id).single();
  if (!user?.referred_by) return;

  const levels = [
    { percent: 25, note: 'Commission parrainage niveau 1' },
    { percent: 3,  note: 'Commission parrainage niveau 2' },
    { percent: 1,  note: 'Commission parrainage niveau 3' }
  ];

  let currentCode = user.referred_by;
  for (const level of levels) {
    const { data: referrer } = await db
      .from('users').select('id').eq('referral_code', currentCode).maybeSingle();
    if (!referrer) break;

    const bonus = amount * (level.percent / 100);
    await updateWallet(referrer.id, 'withdrawal_balance', bonus);
    await logTransaction(referrer.id, 'referral', bonus, 'withdrawal', 'completed', level.note);

    const { data: next } = await db
      .from('users').select('referred_by').eq('id', referrer.id).single();
    if (!next?.referred_by) break;
    currentCode = next.referred_by;
  }
}

// ─── RETRAIT ─────────────────────────────────────────────
async function requestWithdrawal(user_id, amount, mobile_number, country_code, operator) {
  const now  = new Date();
  const hour = now.getHours();
  if (hour < 7 || hour >= 18) return { error: 'Les retraits sont disponibles de 7h à 18h.' };
  if (amount < 1000) return { error: 'Montant minimum de retrait : 1 000 F.' };

  const wallet = await getWallet(user_id);
  if (!wallet || wallet.withdrawal_balance < amount) return { error: 'Solde insuffisant.' };

  const fee        = amount * 0.10;
  const amount_net = amount - fee;

  await updateWallet(user_id, 'withdrawal_balance', -amount);

  const { error } = await db.from('withdrawals').insert({
    user_id, amount, fee, amount_net, mobile_number, country_code, operator
  });
  if (error) {
    await updateWallet(user_id, 'withdrawal_balance', amount);
    return { error: error.message };
  }

  await logTransaction(user_id, 'withdrawal', amount, 'withdrawal', 'pending', `Retrait via ${operator}`);
  return { success: true, amount_net };
}

// ─── SUPPORT ─────────────────────────────────────────────
async function sendSupportMessage(user_id, message) {
  const { error } = await db.from('support_messages')
    .insert({ user_id, message, sender: 'user' });
  return error ? { error: error.message } : { success: true };
}

async function getSupportMessages(user_id) {
  const { data, error } = await db
    .from('support_messages').select('*').eq('user_id', user_id)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data;
}

// ─── TRANSACTIONS ────────────────────────────────────────
async function getTransactions(user_id) {
  const { data, error } = await db
    .from('transactions').select('*').eq('user_id', user_id)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

async function logTransaction(user_id, type, amount, wallet, status, note) {
  await db.from('transactions').insert({ user_id, type, amount, wallet, status, note });
}

// ─── UTILITAIRES ─────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function isAccountActive(user_id) {
  const { data } = await db.from('users').select('is_active').eq('id', user_id).single();
  return data?.is_active === true;
}

function saveSession(user) { localStorage.setItem('inditex_user', JSON.stringify(user)); }
function getSession()      { const d = localStorage.getItem('inditex_user'); return d ? JSON.parse(d) : null; }
function clearSession()    { localStorage.removeItem('inditex_user'); }

function formatMoney(amount) { return Number(amount).toLocaleString('fr-FR') + ' F'; }

function getCountries() {
  return [
    { name: 'Togo',           code: '+228' },
    { name: 'Bénin',          code: '+229' },
    { name: 'Côte d\'Ivoire', code: '+225' },
    { name: 'Cameroun',       code: '+237' }
  ];
}