// ─────────────────────────────────────────────────────────
// app.js — Logique globale INDITEX
// ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
  const page = getCurrentPage();

  // ✅ Ignorer toutes les pages admin
  if (window.location.pathname.includes('/admin/')) return;

  // Pages publiques
  if (['index', 'login', 'register'].includes(page)) {
    const user = getSession();
    if (user) { window.location.href = 'dashboard.html'; return; }
    if (page === 'index') {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) { window.location.href = 'register.html?ref=' + ref; return; }
    }
    return;
  }

  // Pages privées
  const privatePages = [
    'dashboard', 'products', 'withdraw', 'deposit', 'deposit-callback',
    'team', 'profile', 'support', 'history'
  ];

  if (privatePages.includes(page)) {
    const user = getSession();
    if (!user) { window.location.href = 'login.html'; return; }

    const { data: freshUser } = await db
      .from('users').select('is_frozen, is_active').eq('id', user.id).single();

    if (freshUser?.is_frozen) {
      clearSession();
      window.location.href = 'login.html?frozen=1';
      return;
    }

    if (freshUser && freshUser.is_active !== user.is_active) {
      saveSession({ ...user, is_active: freshUser.is_active });
    }

    // ✅ Gains journaliers → portefeuille retrait
    await creditDailyFixedGain(user.id);
    await creditCompletedShortPlans(user.id);
    await checkUnreadSupport(user.id);
  }
});

function getCurrentPage() {
  return window.location.pathname.split('/').pop().replace('.html', '') || 'index';
}

// ─── GAIN JOURNALIER PLAN FIXE → RETRAIT ─────────────────
async function creditDailyFixedGain(user_id) {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: plan } = await db
      .from('user_plans').select('*, plans(daily_gain)')
      .eq('user_id', user_id).eq('type', 'fixed').eq('status', 'active').single();

    if (!plan) return;
    if (plan.last_credit_date === today) return;

    if (new Date() > new Date(plan.end_date)) {
      await db.from('user_plans').update({ status: 'completed' }).eq('id', plan.id);
      return;
    }

    const dailyGain = plan.plans?.daily_gain || 200;

    // ✅ Créditer portefeuille RETRAIT (plus unique)
    await updateWallet(user_id, 'withdrawal_balance', dailyGain);
    await logTransaction(user_id, 'gain_fixed', dailyGain, 'withdrawal', 'completed',
      'Gain journalier plan fixe');
    await db.from('user_plans').update({ last_credit_date: today }).eq('id', plan.id);

  } catch (err) {
    console.error('creditDailyFixedGain error:', err);
  }
}

// ─── PLANS COURTS TERMINÉS → RETRAIT ─────────────────────
async function creditCompletedShortPlans(user_id) {
  try {
    const { data: plans } = await db
      .from('user_plans').select('*')
      .eq('user_id', user_id).eq('type', 'short').eq('status', 'active')
      .lte('end_date', new Date().toISOString());

    if (!plans || plans.length === 0) return;

    for (const plan of plans) {
      await updateWallet(user_id, 'withdrawal_balance', plan.gain_total);
      await logTransaction(user_id, 'gain_short', plan.gain_total, 'withdrawal',
        'completed', 'Gain plan court terminé');
      await db.from('user_plans').update({ status: 'completed' }).eq('id', plan.id);
    }
  } catch (err) {
    console.error('creditCompletedShortPlans error:', err);
  }
}

// ─── BADGE SUPPORT ────────────────────────────────────────
async function checkUnreadSupport(user_id) {
  try {
    const { data: msgs } = await db
      .from('support_messages').select('id')
      .eq('user_id', user_id).eq('sender', 'admin').eq('is_read', false);
    const badge = document.getElementById('supportBadge');
    if (badge && msgs?.length > 0) badge.style.display = 'block';
  } catch (err) {
    console.error('checkUnreadSupport error:', err);
  }
}

// ─── COMPTE GELÉ ─────────────────────────────────────────
window.addEventListener('load', function() {
  if (new URLSearchParams(window.location.search).get('frozen') === '1') {
    setTimeout(() => {
      const el = document.getElementById('alertBox');
      if (el) { el.textContent = 'Votre compte a été suspendu. Contactez le support.'; el.classList.add('show'); }
    }, 300);
  }
});

window.addEventListener('unhandledrejection', e => console.error('Erreur:', e.reason));