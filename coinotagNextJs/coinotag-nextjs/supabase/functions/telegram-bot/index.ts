import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declare Deno globally (Edge Function runtime provides this)
declare const Deno: any;

interface TelegramUpdate {
  message: {
    message_id: number;
    from: {
      id: number;
      username?: string;
      first_name: string;
    };
    text: string;
    chat: {
      id: number;
    };
  };
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Telegram Bot API functions
async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: any) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not found');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  });

  return response.json();
}

// Pending verification kontrol fonksiyonu
async function checkPendingVerification(chatId: number, userId: number, username: string, supabase: any) {
  try {
    // Username'e göre pending verification ara
    const { data: pending, error } = await supabase
      .from('telegram_verifications')
      .select('*, profiles!inner(*)')
      .eq('telegram_username', username)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !pending) {
      console.log(`📭 No pending verification for @${username}`);
      return false;
    }

    // Telegram user ID'yi güncelle
    await supabase
      .from('telegram_verifications')
      .update({ telegram_user_id: userId.toString() })
      .eq('id', pending.id);

    // Onay mesajı gönder
    const confirmMessage = `
🔗 <b>Hesap Bağlama Onayı</b>

📧 E-posta: ${pending.profiles.email}
👤 Telegram: @${username}

Bu hesabı Coinotag ile bağlamak istiyor musunuz?

🚨 Bağlandıktan sonra fiyat alarmlarınızı Telegram'dan alacaksınız!
`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Evet", callback_data: "confirm_yes" },
          { text: "❌ Hayır", callback_data: "confirm_no" }
        ]
      ]
    };

    await sendTelegramMessage(chatId, confirmMessage, keyboard);
    console.log(`🔔 Confirmation sent to @${username} (${userId})`);
    return true;

  } catch (error) {
    console.error('❌ checkPendingVerification error:', error);
    return false;
  }
}

// Telegram verification tamamlama fonksiyonu
async function completeTelegramVerification(pending: any, userId: number, username: string, chatId: number, supabase: any) {
  try {
    // Verification'ı onayla
    await supabase
      .from('telegram_verifications')
      .update({ verified: true })
      .eq('id', pending.id);

    // Profile'ı güncelle
    await supabase
      .from('profiles')
      .update({
        telegram_user_id: userId.toString(),
        telegram_username: username,
        telegram_verified: true,
        telegram_notifications: true
      })
      .eq('id', pending.user_id);

    const successMessage = `
✅ <b>Hesabınız başarıyla bağlandı!</b>

👤 ${pending.profiles.email}
📱 @${username}

🔔 Artık fiyat alarmlarınızı Telegram'dan alacaksınız!
🚀 İyi işlemler!
`;

    await sendTelegramMessage(chatId, successMessage);
    console.log(`✅ User verified: ${pending.user_id} -> Telegram: ${userId}`);

  } catch (error) {
    console.error('❌ completeTelegramVerification error:', error);
    await sendTelegramMessage(chatId, '❌ Bağlantı tamamlanırken hata oluştu. Lütfen tekrar deneyin.');
  }
}

// Ana Handler
Deno.serve(async (req) => {
  console.log(`📞 ${req.method} isteği geldi: ${req.url}`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Sadece POST istekleri kabul edilir' }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log('🤖 Telegram update alındı:', JSON.stringify(update, null, 2));

    if (!update.message) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username;
    const text = message.text;

    // Supabase client oluştur
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Komut işleme
    if (text.startsWith('/start')) {
      const welcomeMessage = `
🚀 <b>COINOTAG Bot'a Hoş Geldiniz!</b>

Hesabınızı bağlamak için:

1️⃣ <a href="https://coinotag.com/ayarlar">coinotag.com/ayarlar</a> sayfasına gidin
2️⃣ Telegram kullanıcı adınızı girin: <code>@${username || 'username'}</code>
3️⃣ "Bağla" butonuna basın
4️⃣ Size gelecek onay mesajını kabul edin

📊 Bağlandıktan sonra kripto alarm bildirimlerini burada alacaksınız!
`;

      await sendTelegramMessage(chatId, welcomeMessage);

      // Username varsa pending verification kontrol et
      if (username) {
        await checkPendingVerification(chatId, userId, username, supabase);
      }

    } else if (text.startsWith('/verify ')) {
      // /verify CODE komutu
      const code = text.split(' ')[1];
      console.log(`🔐 Verification attempt - Code: ${code}, User: ${userId} (@${username})`);
      
      if (!code) {
        await sendTelegramMessage(chatId, '❌ Kod eksik! Kullanım: /verify KODUNUZ');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // API'ye verification isteği gönder
      try {
        const verifyResponse = await fetch('https://coinotag.com/api/telegram/verify', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: code,
            telegram_id: userId.toString()
          })
        });

        if (verifyResponse.ok) {
          const successMessage = `
✅ <b>Hesabınız başarıyla bağlandı!</b>

👤 Telegram: @${username}
📱 Chat ID: ${userId}

🔔 Artık fiyat alarmlarınızı Telegram'dan alacaksınız!
🚀 İyi işlemler!
`;
          await sendTelegramMessage(chatId, successMessage);
          console.log(`✅ User verified via /verify - Code: ${code}, User: ${userId}`);
        } else {
          const errorData = await verifyResponse.json();
          console.log(`❌ Verification failed - Code: ${code}, Error:`, errorData);
          
          let errorMessage = '❌ Doğrulama başarısız!';
          if (errorData.error?.includes('expired')) {
            errorMessage += '\n⏰ Kod süresi dolmuş. Yeni kod alın.';
          } else if (errorData.error?.includes('Invalid')) {
            errorMessage += '\n🔐 Geçersiz kod. Kontrol edin.';
          }
          errorMessage += '\n\n💡 Yeni kod almak için: coinotag.com/ayarlar';
          
          await sendTelegramMessage(chatId, errorMessage);
        }
      } catch (error) {
        console.error('❌ API call failed:', error);
        await sendTelegramMessage(chatId, '❌ Sistem hatası. Lütfen daha sonra tekrar deneyin.');
      }

    } else if (text === 'Evet' || text === '✅ Evet' || text.toLowerCase().includes('onay')) {
      // Bağlantı onayı 
      console.log(`🔗 User ${userId} (@${username}) bağlantıyı onayladı`);
      
      // Pending verification kontrolü
      const { data: pending, error } = await supabase
        .from('telegram_verifications')
        .select('*, profiles!inner(*)')
        .eq('telegram_user_id', userId.toString())
        .eq('verified', false)
        .single();

      if (error || !pending) {
        await sendTelegramMessage(chatId, '❌ Bekleyen bağlantı isteği bulunamadı. Lütfen önce coinotag.com/ayarlar sayfasından bağlantı isteği gönderin.');
      } else {
        await completeTelegramVerification(pending, userId, username, chatId, supabase);
      }

    } else if (text === 'Hayır' || text === '❌ Hayır' || text.toLowerCase().includes('iptal')) {
      // Bağlantı reddi
      await sendTelegramMessage(chatId, '❌ Bağlantı isteği iptal edildi. Hesabınız bağlanmadı.');
      
      // Pending verification'ı sil
      await supabase
        .from('telegram_verifications')
        .delete()
        .eq('telegram_user_id', userId.toString())
        .eq('verified', false);

    } else {
      // Herhangi bir mesaj geldiğinde pending verification kontrol et
      console.log(`📩 User ${userId} (@${username}) mesaj gönderdi: ${text}`);
      
      if (username) {
        const handled = await checkPendingVerification(chatId, userId, username, supabase);
        
        if (!handled) {
          // Bilinmeyen mesaj
          const helpMessage = `
❓ Anlamadım. 

📝 Yapabilecekleriniz:
• /start - Bot hakkında bilgi
• coinotag.com/ayarlar'dan hesap bağla

💡 Yardım için: <a href="https://coinotag.com/iletisim">İletişim</a>
`;

          await sendTelegramMessage(chatId, helpMessage);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Telegram bot hatası:', error);
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Bot hatası: ${(error as Error).message}`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
}); 