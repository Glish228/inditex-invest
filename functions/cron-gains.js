// ─────────────────────────────────────────────────────────
// cron-gains.js — Cloudflare Worker Cron
// Trigger : toutes les heures  →  0 * * * *
// ─────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://oxwvofgenucbebcbiztc.supabase.co';
const SUPABASE_SERVICE = env.SUPABASE_SERVICE_ROLE_KEY; // clé service role Supabase

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(creditDueGains());
  }
};

async function creditDueGains() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const today = now.toISOString().split('T')[0];
  
  // Récupérer tous les plans actifs dont l'heure de crédit = heure actuelle
  // et qui n'ont pas encore été crédités aujourd'hui
  const plans = await supabaseQuery(`
    SELECT up.id, up.user_id, up.last_credit_date, up.end_date,
           p.daily_gain, p.name
    FROM user_plans up
    JOIN plans p ON p.id = up.plan_id
    WHERE up.status = 'active'
      AND up.credit_hour = ${currentHour}
      AND (up.last_credit_date IS NULL OR up.last_credit_date < '${today}')
  `);
  
  if (!plans.length) return;
  
  for (const plan of plans) {
    // Plan expiré → completed, pas de gain
    if (new Date() > new Date(plan.end_date)) {
      await supabasePatch(`user_plans?id=eq.${plan.id}`, { status: 'completed' });
      continue;
    }
    
    const gain = plan.daily_gain;
    
    // Créditer portefeuille retrait
    await supabaseRpc('increment_wallet', {
      p_user_id: plan.user_id,
      p_field: 'withdrawal_balance',
      p_amount: gain
    });
    
    // Logger la transaction
    await supabaseInsert('transactions', {
      user_id: plan.user_id,
      type: 'gain_daily',
      amount: gain,
      wallet: 'withdrawal',
      status: 'completed',
      note: `Gain journalier — ${plan.name}`
    });
    
    // Mettre à jour last_credit_date
    await supabasePatch(`user_plans?id=eq.${plan.id}`, {
      last_credit_date: today
    });
  }
}

// ─── Helpers Supabase REST ────────────────────────────────
async function supabaseQuery(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ query: sql })
  });
  const data = await res.json();
  return data || [];
}

async function supabaseInsert(table, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });
}

async function supabasePatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body)
  });
}

async function supabaseRpc(fn, params) {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params)
  });
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE,
    'Authorization': `Bearer ${SUPABASE_SERVICE}`,
    'Prefer': 'return=minimal'
  };
}