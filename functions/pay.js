export async function onRequest(context) {
  const SUPABASE_URL         = 'https://oxwvofgenucbebcbiztc.supabase.co';
  const SUPABASE_SERVICE_KEY = context.env.SUPABASE_SERVICE_KEY;
  const FLINPAY_API_KEY      = context.env.FLINPAY_API_KEY;
  const FLINPAY_BASE_URL     = 'https://www.flinpay.cfd';

  const COUNTRIES = { '+228':'TG', '+229':'BJ', '+225':'CI', '+237':'CM' };
  const OPERATORS = { '+228':'momo', '+229':'momo', '+225':'momo', '+237':'momo' };

  const headers = {
    'apikey':        SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json'
  };

  try {
    const body = await context.request.json();
    const { user_id, plan_id, phone, country_code } = body;

    if (!user_id || !plan_id || !phone || !country_code) {
      return new Response(
        JSON.stringify({ error: 'Données manquantes.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' }}
      );
    }

    const country  = COUNTRIES[country_code];
    const operator = OPERATORS[country_code];

    if (!country) {
      return new Response(
        JSON.stringify({ error: 'Pays non supporté.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' }}
      );
    }

    // Récupérer le plan
    const planRes = await fetch(
      `${SUPABASE_URL}/rest/v1/plans?id=eq.${plan_id}&select=*`,
      { headers }
    );
    const plans = await planRes.json();
    if (!plans.length) {
      return new Response(
        JSON.stringify({ error: 'Plan introuvable.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' }}
      );
    }
    const plan = plans[0];

    // Récupérer l'utilisateur
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}&select=full_name`,
      { headers }
    );
    const users      = await userRes.json();
    const clientName = users[0]?.full_name || 'Client';

    // Générer order_id unique
    const orderId = 'ORD-' + user_id.substring(0, 8) + '-' + Date.now();

    // Enregistrer le dépôt en pending
    await fetch(`${SUPABASE_URL}/rest/v1/deposits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id,
        plan_id,
        amount:      plan.price,
        flinpay_ref: orderId,
        status:      'pending'
      })
    });

    // Appel API Flinpay
    const flinRes = await fetch(`${FLINPAY_BASE_URL}/api/pay`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FLINPAY_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        amount:      plan.price,
        phone:       phone,
        client_name: clientName,
        order_id:    orderId,
        country:     country,
        operator:    operator
      })
    });

    const flinResult = await flinRes.json();

    if (!flinRes.ok || flinResult.error) {
      // Marquer dépôt échoué
      await fetch(
        `${SUPABASE_URL}/rest/v1/deposits?flinpay_ref=eq.${orderId}`,
        { method: 'PATCH', headers, body: JSON.stringify({ status: 'failed' }) }
      );
      return new Response(
        JSON.stringify({ error: flinResult.message || 'Échec du paiement. Réessayez.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' }}
      );
    }

    return new Response(
      JSON.stringify({ success: true, order_id: orderId }),
      { status: 200, headers: { 'Content-Type': 'application/json' }}
    );

  } catch (err) {
    console.error('Pay function error:', err);
    return new Response(
      JSON.stringify({ error: 'Erreur serveur.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' }}
    );
  }
}