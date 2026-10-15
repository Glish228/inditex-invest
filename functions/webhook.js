export async function onRequest(context) {
  const SUPABASE_URL         = 'https://oxwvofgenucbebcbiztc.supabase.co';
  const SUPABASE_SERVICE_KEY = context.env.SUPABASE_SERVICE_KEY;

  const headers = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json'
  };

  try {
    const body     = await context.request.json();
    const order_id = body.order_id;
    const status   = body.status;

    if (!order_id || !status) {
      return new Response('Données manquantes.', { status: 400 });
    }

    // Trouver le dépôt
    const depRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deposits?flinpay_ref=eq.${order_id}&select=*,plans(*)`,
      { headers }
    );
    const deposits = await depRes.json();
    if (!deposits.length) return new Response('OK', { status: 200 });

    const deposit = deposits[0];
    if (deposit.status !== 'pending') return new Response('OK', { status: 200 });

    if (status === 'payment.success') {

      // Confirmer dépôt
      await fetch(
        `${SUPABASE_URL}/rest/v1/deposits?id=eq.${deposit.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) }
      );

      const plan    = deposit.plans;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.duration_days);

      if (plan.type === 'fixed') {

        // Créer user_plan fixe
        await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id:     deposit.user_id,
            plan_id:     plan.id,
            type:        'fixed',
            amount_paid: plan.price,
            start_date:  new Date().toISOString(),
            end_date:    endDate.toISOString()
          })
        });

        // Activer compte
        await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${deposit.user_id}`,
          { method: 'PATCH', headers, body: JSON.stringify({ is_active: true }) }
        );

        // Bonus activation 500F
        await creditWallet(SUPABASE_URL, headers, deposit.user_id, 'withdrawal_balance', 500);
        await insertTransaction(SUPABASE_URL, headers, deposit.user_id, 'bonus_activation', 500, 'withdrawal', 'Bonus activation compte');

        // Commissions parrainage
        await handleReferral(SUPABASE_URL, headers, deposit.user_id, plan.price);

      } else {

        // Calculer gain total
        const gainTotal = plan.price * (plan.total_gain_percent / 100) + plan.price;

        // Vérifier si premier plan court
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_plans?user_id=eq.${deposit.user_id}&type=eq.short&select=id`,
          { headers }
        );
        const existing = await countRes.json();
        const isFirst  = existing.length === 0;

        // Créer user_plan court
        await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id:     deposit.user_id,
            plan_id:     plan.id,
            type:        'short',
            amount_paid: plan.price,
            gain_total:  gainTotal,
            start_date:  new Date().toISOString(),
            end_date:    endDate.toISOString()
          })
        });

        // Bonus premier plan court 500F
        if (isFirst) {
          await creditWallet(SUPABASE_URL, headers, deposit.user_id, 'withdrawal_balance', 500);
          await insertTransaction(SUPABASE_URL, headers, deposit.user_id, 'bonus_first_short', 500, 'withdrawal', 'Bonus premier plan court');
        }
      }

      // Transaction dépôt
      await insertTransaction(
        SUPABASE_URL, headers,
        deposit.user_id, 'deposit',
        deposit.amount, 'unique',
        'Dépôt confirmé Flinpay'
      );

    } else if (status === 'payment.failed') {

      await fetch(
        `${SUPABASE_URL}/rest/v1/deposits?id=eq.${deposit.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ status: 'failed' }) }
      );
    }

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Error', { status: 500 });
  }
}

// ─── HELPERS ──────────────────────────────────────────────
async function creditWallet(url, headers, user_id, field, amount) {
  const res  = await fetch(
    `${url}/rest/v1/wallets?user_id=eq.${user_id}&select=*`,
    { headers }
  );
  const data = await res.json();
  if (!data.length) return;
  const newBalance = Number(data[0][field]) + Number(amount);
  await fetch(`${url}/rest/v1/wallets?user_id=eq.${user_id}`, {
    method: 'PATCH',
    headers,
    body:   JSON.stringify({ [field]: newBalance, updated_at: new Date().toISOString() })
  });
}

async function insertTransaction(url, headers, user_id, type, amount, wallet, note) {
  await fetch(`${url}/rest/v1/transactions`, {
    method: 'POST',
    headers,
    body:   JSON.stringify({ user_id, type, amount, wallet, status: 'completed', note })
  });
}

async function handleReferral(url, headers, user_id, amount) {
  const userRes = await fetch(
    `${url}/rest/v1/users?id=eq.${user_id}&select=referred_by`,
    { headers }
  );
  const users = await userRes.json();
  if (!users.length || !users[0].referred_by) return;

  const levels = [
    { percent: 25, note: 'Commission parrainage niveau 1' },
    { percent: 3,  note: 'Commission parrainage niveau 2' },
    { percent: 1,  note: 'Commission parrainage niveau 3' }
  ];

  let currentCode = users[0].referred_by;

  for (const level of levels) {
    const refRes = await fetch(
      `${url}/rest/v1/users?referral_code=eq.${currentCode}&select=id,referred_by`,
      { headers }
    );
    const refs = await refRes.json();
    if (!refs.length) break;

    const bonus = amount * (level.percent / 100);
    await creditWallet(url, headers, refs[0].id, 'withdrawal_balance', bonus);
    await insertTransaction(url, headers, refs[0].id, 'referral', bonus, 'withdrawal', level.note);

    if (!refs[0].referred_by) break;
    currentCode = refs[0].referred_by;
  }
}