import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface PriceData {
  symbol: string;
  price: number;
  marketType: 'spot' | 'futures';
  timestamp: number;
}

interface AlertData {
  id: string;
  user_id: string;
  user_email: string;
  symbol: string;
  market_type: 'spot' | 'futures';
  alert_type: string;
  condition_value: number;
  target_price?: number;
  notification_methods: string[];
  is_active: boolean;
  is_recurring: boolean;
}

// Production logger
const isDev = Deno.env.get('DENO_ENV') !== 'production';
const safeLog = {
  info: (msg: string, data?: any) => {
    if (isDev) console.log(msg, data);
  },
  error: (msg: string, error?: any) => {
    console.error(msg, error); // Error logları production'da da tutulabilir
  },
  warn: (msg: string, data?: any) => {
    if (isDev) console.warn(msg, data);
  }
};

// Telegram bildirimi gönder
async function sendTelegramAlert(telegramUserId: string, alertData: {
  symbol: string;
  marketType: 'spot' | 'futures';
  alertType: string;
  currentPrice: number;
  targetPrice: number;
  isRecurring?: boolean;
}) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    safeLog.error('TELEGRAM_BOT_TOKEN not found');
    return { success: false, error: 'Bot token not configured' };
  }

  // Profesyonel trading Telegram formatı
  const isPositive = alertData.alertType === 'PRICE_ABOVE' || alertData.alertType === 'RESISTANCE_BREAK';
  const priceEmoji = isPositive ? '🟢' : '🔴';
  const directionEmoji = isPositive ? '🚀' : '📉';
  const marketEmoji = alertData.marketType === 'futures' ? '⚡' : '💎';
  const recurringEmoji = alertData.isRecurring ? '🔄' : '🎯';
  
  // Price change calculation
  const priceChange = ((alertData.currentPrice - alertData.targetPrice) / alertData.targetPrice * 100).toFixed(2);
  const changeEmoji = parseFloat(priceChange) >= 0 ? '🟢' : '🔴';
  const changeText = parseFloat(priceChange) >= 0 ? `+${priceChange}%` : `${priceChange}%`;
  
  const message = `${directionEmoji} <b>${alertData.symbol}USDT Alert Tetiklendi</b> ${recurringEmoji}

  ${marketEmoji} <b>Market:</b> ${alertData.marketType.toUpperCase()}
  ${priceEmoji} <b>Fiyat:</b> $${alertData.currentPrice.toLocaleString()}
  🎯 <b>Hedef:</b> $${alertData.targetPrice.toLocaleString()}
  ${changeEmoji} <b>Değişim:</b> ${changeText}
  ⏰ <b>Tip:</b> ${alertData.isRecurring ? 'Sürekli İzleme' : 'Tek Seferlik'}

  📈 <b>COINOTAG Alert System</b>
  <i>Profesyonel kripto takip platformu</i>

  🔔 ${alertData.isRecurring ? 'Bu sürekli alarm her dakika kontrol edilecek' : 'Bu alarm artık pasif durumda'}

  <a href="https://coinotag.com/kripto-paralar${alertData.marketType === 'futures' ? '/futures' : ''}/${alertData.symbol.toLowerCase()}">📊 ${alertData.symbol} Chart'ı Görüntüle</a>`;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramUserId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      })
    });

    const result = await response.json();
    
    if (result.ok) {
      return { success: true, message: 'Telegram sent successfully' };
    } else {
      safeLog.error('Telegram API error', result);
      return { success: false, error: result.description };
    }
  } catch (error) {
    safeLog.error('Telegram send error', error);
    return { success: false, error: 'Network error' };
  }
}

serve(async (req: Request) => {
  try {
    // CORS headers
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST',
        },
      })
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { prices }: { prices: PriceData[] } = await req.json()

    if (!prices || !Array.isArray(prices)) {
      return new Response(JSON.stringify({ error: 'Invalid prices data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Supabase client oluştur
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    let triggeredAlerts = 0
    const alertIds: string[] = []
    const triggeredUserAlerts: Array<{alert: AlertData, currentPrice: number}> = []

    // Her price update için aktif alarmları kontrol et
    for (const priceData of prices) {
      safeLog.info(`Checking alarms for ${priceData.symbol} (${priceData.marketType}) @ $${priceData.price}`)
      
      // İlgili sembol ve market type için aktif alarmları getir
      const { data: alerts, error } = await supabase
        .from('user_alerts')
        .select('*')
        .eq('symbol', priceData.symbol)
        .eq('market_type', priceData.marketType)
        .eq('is_active', true)

      if (error) {
        safeLog.error(`Database error for ${priceData.symbol}`, error)
        continue
      }

      safeLog.info(`Found ${alerts?.length || 0} active alerts for ${priceData.symbol} (${priceData.marketType})`)
      if (alerts && alerts.length > 0) {
        safeLog.info(`Alerts details:`, alerts.map((a: AlertData) => `${a.alert_type} ${a.condition_value}`))
      }

      if (!alerts || alerts.length === 0) continue

      // Her alarm için koşul kontrolü
      for (const alert of alerts) {
        let shouldTrigger = false
        
        switch (alert.alert_type) {
          case 'PRICE_ABOVE':
            shouldTrigger = priceData.price > alert.condition_value
            break
          case 'PRICE_BELOW':
            shouldTrigger = priceData.price < alert.condition_value
            break
          case 'SUPPORT_BREAK':
            shouldTrigger = priceData.price < alert.condition_value
            break
          case 'RESISTANCE_BREAK':
            shouldTrigger = priceData.price > alert.condition_value
            break
        }

        if (shouldTrigger) {
          // Sürekli alarm logic'i - sadece tek seferlik alarmları deaktive et
          if (!alert.is_recurring) {
            await supabase
              .from('user_alerts')
              .update({ is_active: false, triggered_at: new Date().toISOString() })
              .eq('id', alert.id)
          } else {
            // Sürekli alarmlar için sadece triggered_at güncelle
            await supabase
              .from('user_alerts')
              .update({ triggered_at: new Date().toISOString() })
              .eq('id', alert.id)
          }

          // Notification kaydı oluştur
          await supabase
            .from('alert_notifications')
            .insert({
              user_id: alert.user_id,
              alert_id: alert.id,
              symbol: alert.symbol,
              market_type: alert.market_type,
              alert_type: alert.alert_type,
              triggered_price: priceData.price,
              target_price: alert.condition_value,
              triggered_at: new Date().toISOString()
            })

          safeLog.info(`${alert.symbol} ${alert.alert_type} triggered @ $${priceData.price}`)
          
          triggeredAlerts++
          alertIds.push(alert.id)
          triggeredUserAlerts.push({ alert, currentPrice: priceData.price })
        }
      }
    }

    safeLog.info(`${triggeredUserAlerts.length} alarm tetiklendi, bildirimler gönderiliyor...`)

    // Tetiklenen alarmlar için bildirim gönder
    for (const { alert, currentPrice } of triggeredUserAlerts) {
      // USER EMAIL'I AUTH TABLOSUNDAN ÇEK
      let userEmail = alert.user_email; // Önce mevcut değeri dene
      
      if (!userEmail) {
        // Eğer user_email boşsa, auth.users tablosundan çek
        try {
          const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(alert.user_id);
          if (!authUserError && authUser?.user?.email) {
            userEmail = authUser.user.email;
            safeLog.info(`📧 Fetched email from auth.users for user ${alert.user_id}: ${userEmail}`);
          } else {
            safeLog.error(`❌ Could not fetch email for user ${alert.user_id}:`, authUserError);
          }
        } catch (authError) {
          safeLog.error(`❌ Auth error for user ${alert.user_id}:`, authError);
        }
      }
      
      // Email bildirim kontrolü (notification_methods array'inde 'email' var mı?)
      if (alert.notification_methods.includes('email') && userEmail) {
        try {
          safeLog.info(`Sending email to: ${userEmail} for ${alert.symbol}`)
          
          const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/smtp-check`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              userEmail: userEmail, // Güncellenmiş email kullan
              subject: `${alert.symbol} Alert Triggered`,
              alertType: alert.alert_type,
              symbol: alert.symbol,
              currentPrice: currentPrice,
              conditionValue: alert.condition_value, // targetPrice -> conditionValue
              marketType: alert.market_type
            })
          })

          const emailResult = await emailResponse.json()
          if (emailResult.success) {
            safeLog.info(`Email sent successfully to: ${userEmail}`, emailResult)
          } else {
            safeLog.error(`Email error for ${userEmail}`, emailResult)
          }
        } catch (emailError) {
          safeLog.error(`Email exception for ${userEmail}`, emailError)
        }
      } else {
        safeLog.info(`Skipping email for ${alert.symbol} - no email notification or missing email`)
        safeLog.info(`   Notification methods: ${JSON.stringify(alert.notification_methods)}`)
        safeLog.info(`   Alert user_email: ${alert.user_email}`)
        safeLog.info(`   Fetched userEmail: ${userEmail}`)
      }

      // Telegram bildirim kontrolü
      if (alert.notification_methods.includes('telegram')) {
        try {
          // User'ın Telegram profilini al
          const { data: profile } = await supabase
            .from('profiles')
            .select('telegram_user_id, telegram_verified, telegram_notifications_enabled')
            .eq('id', alert.user_id)
            .single()

          if (!profile) {
            safeLog.info(`No Telegram profile found for user: ${alert.user_id}`);
            continue;
          }
          if (!profile.telegram_verified || !profile.telegram_notifications_enabled) {
            safeLog.info(`Telegram not verified or disabled for user: ${alert.user_id}`);
            continue;
          }
          if (!profile.telegram_user_id) {
            safeLog.info(`No Telegram user ID for user: ${alert.user_id}`);
            continue;
          }
          safeLog.info(`Sending Telegram notification to: ${profile.telegram_user_id} for ${alert.symbol}`);

          const telegramResult = await sendTelegramAlert(profile.telegram_user_id, {
            symbol: alert.symbol,
            marketType: alert.market_type,
            alertType: alert.alert_type,
            currentPrice: currentPrice,
            targetPrice: alert.condition_value,
            isRecurring: alert.is_recurring
          });

          if (telegramResult.success) {
            safeLog.info(`Telegram sent successfully to: ${profile.telegram_user_id}`);
          } else {
            safeLog.error(`Telegram error for ${profile.telegram_user_id}`, telegramResult.error);
          }

        } catch (telegramError) {
          safeLog.error(`Telegram exception for ${alert.symbol}`, telegramError);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${prices.length} price updates`,
      triggeredAlerts,
      alertIds
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })

  } catch (error) {
    safeLog.error('Alarm monitor error', error)
    
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
}) 