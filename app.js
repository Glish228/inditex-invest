// ─────────────────────────────────────────────────────────
// app.js — Logique globale de l'application INDITEX
// ─────────────────────────────────────────────────────────

// ─── PROTECTION PAGES PRIVÉES ────────────────────────────
function requireAuth() {
  const user = getSession();
  if (!user) window.location.href = 'login.html';
  return user;
}

function requireNoAuth() {
  const user = getSession();
  if (user) window.location.href = 'dashboard.html';
}

// ─── INITIALISATION PAR PAGE ─────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  const page = getCurrentPage();
  
  // ✅ Ignorer toutes les pages admin — elles ont leur propre auth
  if (window.location.pathname.includes('/admin/')) return;
  
  // Pages publiques — redirige si déjà connecté
  if (['index', 'login', 'register'].includes(page)) {
    const user = getSession();
    if (user) {
      window.location.href = 'dashboard.html';
      return;
    }
    if (page === 'index') {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref) {
        window.location.href = 'register.html?ref=' + ref;
        return;
      }
    }
    return;
  }
  
  // Pages privées — redirige si non connecté
  const privatePages = [
    'dashboard', 'products', 'withdraw',
    'team', 'profile', 'support', 'history'
  ];
  
  if (privatePages.includes(page)) {
    const user = getSession();
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    
    // Vérifier que le compte n'est pas gelé
    const { data: freshUser } = await db
      .from('users')
      .select('is_frozen, is_active')
      .eq('id', user.id)
      .single();
    
    if (freshUser?.is_frozen) {
      clearSession();
      window.location.href = 'login.html?frozen=1';
      return;
    }
    
    // Mettre à jour la session si is_active a changé
    if (freshUser && freshUser.is_active !== user.is_active) {
      const updatedUser = { ...user, is_active: freshUser.is_active };
      saveSession(updatedUser);
    }
    
    // Créditer les gains journaliers plan fixe
    await creditDailyFixedGain(user.id);
    
    // Créditer plans courts terminés
    await creditCompletedShortPlans(user.id);
    
    // Afficher badge support si messages non lus
    await checkUnreadSupport(user.id);
  }
});

// ─── DÉTECTION PAGE COURANTE ──────────────────────────────
function getCurrentPage() {
  const path = window.location.pathname;
  const file = path.split('/').pop().replace('.html', '');
  return file || 'index';
}

// ─── CRÉDIT GAIN JOURNALIER PLAN FIXE ────────────────────
async function creditDailyFixedGain(user_id) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: plan } = await db
      .from('user_plans')
      .select('*, plans(daily_gain)')
      .eq('user_id', user_id)
      .eq('type', 'fixed')
      .eq('status', 'active')
      .single();
    
    if (!plan) return;
    if (plan.last_credit_date === today) return;
    
    const endDate = new Date(plan.end_date);
    if (new Date() > endDate) {
      await db.from('user_plans')
        .update({ status: 'completed' })
        .eq('id', plan.id);
      return;
    }
    
    const dailyGain = plan.plans?.daily_gain || 300;
    
    // Créditer portefeuille unique
    await updateWallet(user_id, 'unique_balance', dailyGain);
    await logTransaction(
      user_id, 'gain_fixed',
      dailyGain, 'unique',
      'completed', 'Gain journalier plan fixe'
    );
    
    // Mettre à jour last_credit_date
    await db.from('user_plans')
      .update({ last_credit_date: today })
      .eq('id', plan.id);
    
  } catch (err) {
    console.error('creditDailyFixedGain error:', err);
  }
}

// ─── CRÉDIT PLANS COURTS TERMINÉS ────────────────────────
async function creditCompletedShortPlans(user_id) {
  try {
    const { data: plans } = await db
      .from('user_plans')
      .select('*')
      .eq('user_id', user_id)
      .eq('type', 'short')
      .eq('status', 'active')
      .lte('end_date', new Date().toISOString());
    
    if (!plans || plans.length === 0) return;
    
    for (const plan of plans) {
      await updateWallet(user_id, 'withdrawal_balance', plan.gain_total);
      await logTransaction(
        user_id, 'gain_short',
        plan.gain_total, 'withdrawal',
        'completed', 'Gain plan court terminé'
      );
      await db.from('user_plans')
        .update({ status: 'completed' })
        .eq('id', plan.id);
    }
  } catch (err) {
    console.error('creditCompletedShortPlans error:', err);
  }
}

// ─── BADGE SUPPORT NON LUS ───────────────────────────────
async function checkUnreadSupport(user_id) {
  try {
    const { data: msgs } = await db
      .from('support_messages')
      .select('id')
      .eq('user_id', user_id)
      .eq('sender', 'admin')
      .eq('is_read', false);
    
    const badge = document.getElementById('supportBadge');
    if (badge && msgs && msgs.length > 0) {
      badge.style.display = 'block';
    }
  } catch (err) {
    console.error('checkUnreadSupport error:', err);
  }
}

// ─── MESSAGE COMPTE GELÉ ──────────────────────────────────
window.addEventListener('load', function() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('frozen') === '1') {
    setTimeout(() => {
      const alertEl = document.getElementById('alertBox');
      if (alertEl) {
        alertEl.textContent = 'Votre compte a été suspendu. Contactez le support.';
        alertEl.classList.add('show');
      }
    }, 300);
  }
});

// ─── GESTION ERREURS GLOBALES ─────────────────────────────
window.addEventListener('unhandledrejection', function(e) {
  console.error('Erreur non gérée:', e.reason);
});