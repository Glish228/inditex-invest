export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const transactionId = searchParams.get('transactionId');
  
  if (!transactionId) {
    return new Response(JSON.stringify({ error: 'transactionId manquant.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const res = await fetch(
      `https://bkapay.com/api/inline-pay/status/${transactionId}`
    );
    const data = await res.json();
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Erreur connexion BKApay.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}