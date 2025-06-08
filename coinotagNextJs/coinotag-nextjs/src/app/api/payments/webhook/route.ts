import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase-client';

const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

// Helper function to verify the signature
function verifyNowPaymentsSignature(payload: any, signature: string | null, secret: string): boolean {
  if (!signature) {
    return false;
  }
  // NOWPayments dokümantasyonuna göre sıralanmış ve birleştirilmiş string
  // Genellikle payload objesinin sıralı anahtar-değer çiftlerinin JSON string hali kullanılır.
  // Ancak, NOWPayments'ın tam olarak hangi string'i imzaladığını kontrol etmelisin.
  // Bu örnekte, gelen payload'ın stringify edilmiş halini kullanıyoruz.
  // ÖNEMLİ: NOWPayments, gelen payload'ı belirli bir şekilde sıralayıp birleştirerek hash oluşturur.
  // Tam olarak doğru string'i oluşturduğunuzdan emin olun.
  // Genellikle bu, payload objesinin anahtarlarına göre alfabetik olarak sıralanmış
  // ve ardından birleştirilmiş bir string olur.
  // YA DA payload'un olduğu gibi stringify edilmiş hali olabilir.
  // Postman dokümanında veya NOWPayments panelinde IPN için signature oluşturma detayları olmalı.

  // Bu örnekte, gelen payload'ı olduğu gibi stringify edip kullanıyoruz.
  // GERÇEK KULLANIMDA DOĞRU SIRALAMA VE BİRLEŞTİRME YÖNTEMİNİ KULLANIN.
  const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());

  const hmac = crypto.createHmac('sha512', secret);
  hmac.update(Buffer.from(sortedPayload, 'utf-8'));
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

export async function POST(req: NextRequest) {
  if (!NOWPAYMENTS_IPN_SECRET) {
    console.error('NOWPayments IPN secret not configured.');
    return NextResponse.json({ error: 'IPN secret not configured.' }, { status: 500 });
  }

  const signature = req.headers.get('x-nowpayments-sig');
  let rawBody;
  try {
    rawBody = await req.text(); // Önce raw body'yi al
    const payload = JSON.parse(rawBody); // Sonra parse et

    // Signature doğrulaması (GERÇEK IPN SECRET İLE TEST EDİN)
    // if (!verifyNowPaymentsSignature(payload, signature, NOWPAYMENTS_IPN_SECRET)) {
    //   console.warn('Invalid NOWPayments IPN signature', { signature, orderId: payload.order_id });
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    // }
    console.log('NOWPayments IPN Payload Received:', payload);

    const { order_id, payment_status, price_amount, price_currency, actually_paid, pay_currency, outcome_amount, outcome_currency, fee, nowpayments_payment_id } = payload;

    // 1. user_subscriptions tablosunda order_id'ye göre kaydı bul
    const { data: existingSubscription, error: fetchError } = await supabase
      .from('user_subscriptions')
      .select('*, profiles(id, subscription_tier, current_subscription_id)') // profiles join edilebilir
      .eq('order_id', order_id)
      .single();

    if (fetchError || !existingSubscription) {
      console.error('IPN Error: Subscription not found for order_id:', order_id, fetchError);
      // Eğer order_id bulunamazsa, NOWPayments'e bir hata döndürmek yerine loglayıp 200 OK dönebiliriz ki tekrar denemesin.
      return NextResponse.json({ message: 'Order not found, but acknowledged.' });
    }

    let newStatus = existingSubscription.status;
    let updateSubscriptionData: any = {
        nowpayments_payment_id: nowpayments_payment_id,
        paid_amount: actually_paid, // actually_paid NOWPayments'tan gelen isme göre düzeltin
        paid_currency: pay_currency, // pay_currency NOWPayments'tan gelen isme göre düzeltin
        fee_amount: fee, // fee NOWPayments'tan gelen isme göre düzeltin
        outcome_amount: outcome_amount,
        outcome_currency: outcome_currency,
    };
    let updateProfileData: any = {};

    switch (payment_status) {
      case 'waiting':
        newStatus = 'pending_payment';
        break;
      case 'confirming':
        newStatus = 'payment_confirming';
        break;
      case 'confirmed': // Ödeme onayı bekleniyor
        newStatus = 'payment_confirmed_processing';
        break;
      case 'sending': // Ödeme gönderiliyor
        newStatus = 'payment_sending';
        break;
      case 'partially_paid':
        newStatus = 'payment_partially_paid';
        // Kısmi ödeme durumunu ele alabilirsiniz. Şimdilik sadece logluyoruz.
        console.warn('Partially paid order:', order_id);
        break;
      case 'finished':
        newStatus = 'paid';
        updateSubscriptionData.started_at = new Date().toISOString();
        // Abonelik süresini hesapla (örneğin 30 gün)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        updateSubscriptionData.expires_at = expiryDate.toISOString();

        // Kullanıcının profiles tablosundaki abonelik bilgilerini güncelle
        updateProfileData.subscription_tier = existingSubscription.tier;
        updateProfileData.current_subscription_id = existingSubscription.id;
        updateProfileData.subscription_expires_at = expiryDate.toISOString(); // Opsiyonel: profilde de tutulabilir
        break;
      case 'failed':
        newStatus = 'payment_failed';
        break;
      case 'refunded':
        newStatus = 'payment_refunded';
        if (existingSubscription.profiles) {
            updateProfileData.subscription_tier = 'FREE'; // veya null
            updateProfileData.current_subscription_id = null;
            updateProfileData.subscription_expires_at = null;
        }
        break;
      case 'expired':
        newStatus = 'payment_link_expired';
        break;
      default:
        console.warn(`Unknown payment status received: ${payment_status} for order ${order_id}`);
        // Bilinmeyen bir durum için işlem yapma, sadece logla ve çık
        return NextResponse.json({ message: 'Unknown status, acknowledged.' });
    }

    updateSubscriptionData.status = newStatus;

    // 2. user_subscriptions tablosunu güncelle
    const { error: updateError } = await supabase
      .from('user_subscriptions')
      .update(updateSubscriptionData)
      .eq('order_id', order_id);

    if (updateError) {
      console.error('IPN Error: Failed to update subscription status:', order_id, updateError);
      return NextResponse.json({ error: 'Failed to update subscription.' }, { status: 500 });
    }

    // 3. Eğer ödeme başarılıysa (finished) ve profile güncelleme verisi varsa, profiles tablosunu güncelle
    if (payment_status === 'finished' && existingSubscription.profiles && Object.keys(updateProfileData).length > 0) {
        const { error: profileUpdateError } = await supabase
            .from('profiles')
            .update(updateProfileData)
            .eq('id', existingSubscription.user_id); // profiles tablosundaki user_id ile eşleştir

        if (profileUpdateError) {
            console.error('IPN Error: Failed to update profile with subscription details:', existingSubscription.user_id, profileUpdateError);
            // Bu kritik bir hata değil, abonelik güncellendi ama profil güncellenemedi. Logla ve devam et.
        }
    }

    console.log(`Subscription ${order_id} status updated to ${newStatus}`);
    return NextResponse.json({ message: 'Webhook processed successfully.' });

  } catch (error: any) {
    console.error('Error processing NOWPayments IPN:', error);
    // req.text() veya JSON.parse() hatası olabilir
    if (error.message.includes('Unexpected token') || error.message.includes('invalid json')){
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    return NextResponse.json({ error: 'An unexpected error occurred while processing IPN.' }, { status: 500 });
  }
}


// IPN payload'undaki bazı alanlar:
// { 
//   "payment_id": 5068063769,
//   "invoice_id": null,
//   "payment_status": "waiting",
//   "pay_address": "0x12345....",
//   "price_amount": 100,
//   "price_currency": "usd",
//   "pay_amount": 0.0322,
//   "actually_paid": 0,
//   "pay_currency": "eth",
//   "order_id": "your_internal_order_id_123",
//   "order_description": "Subscription for user@example.com",
//   "purchase_id": "6084923918",
//   "created_at": "2021-03-24T16:05:06.523Z",
//   "updated_at": "2021-03-24T16:05:06.523Z",
//   "outcome_amount": 98.5,
//   "outcome_currency": "usd", 
//   "fee": {"currency": "usd", "amount": "1.5"},
//   "nowpayments_payment_id": 12345678
// } 