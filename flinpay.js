const FLINPAY_COUNTRIES = {
  '+228': 'TG',
  '+229': 'BJ',
  '+225': 'CI',
  '+237': 'CM'
};

async function initiateFlinpayDeposit(user_id, plan, payPhone, payCountry) {
  try {
    const country = FLINPAY_COUNTRIES[payCountry];
    if (!country) return { error: 'Pays non supporté pour le paiement.' };
    
    const response = await fetch('/functions/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id,
        plan_id: plan.id,
        phone: payPhone,
        country_code: payCountry
      })
    });
    
    const result = await response.json();
    if (!response.ok) return { error: result.error || 'Échec du paiement.' };
    return { success: true };
    
  } catch (err) {
    console.error('Flinpay error:', err);
    return { error: 'Erreur réseau. Vérifiez votre connexion.' };
  }
}