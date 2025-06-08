// Node.js 18+ built-in fetch kullan
require('dotenv').config({ path: './.env.local' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

console.log('🤖 Telegram verification processor started...');
console.log('🔑 Bot Token Status:', TELEGRAM_BOT_TOKEN ? 'LOADED' : 'NOT FOUND');
console.log('🏠 API Base URL:', API_BASE_URL);

// Son işlenen update ID'yi takip et (offset)
let lastUpdateId = 0; // Baştan başla - tüm mesajları yakala
console.log('🔍 Starting with lastUpdateId:', lastUpdateId);

async function processVerifications() {
  try {
    console.log(`📡 Checking updates from offset: ${lastUpdateId + 1}`);
    
    // Bot mesajlarını al
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=10`);
    const data = await response.json();

    console.log(`📥 Received ${data.result?.length || 0} updates`);

    if (!data.ok || !data.result.length) {
      return;
    }

    for (const update of data.result) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      console.log(`📋 Processing update ${update.update_id}, new lastUpdateId: ${lastUpdateId}`);

      const message = update.message;
      if (!message || !message.text) continue;

      // /verify komutu kontrolü
      const verifyMatch = message.text.match(/^\/verify\s+([A-Z0-9]+)$/);
      if (verifyMatch) {
        const verificationCode = verifyMatch[1];
        const chatId = message.chat.id;
        
        console.log(`✅ Found verify command: ${verificationCode} from chat ${chatId}`);

        try {
          // Manuel doğrulama API'sını çağır
          const verifyResponse = await fetch(`${API_BASE_URL}/api/telegram/manual-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: verificationCode,
              chatId: chatId.toString()
            })
          });

          const verifyResult = await verifyResponse.json();
          
          if (verifyResult.success) {
            console.log(`🎉 Verification successful for code: ${verificationCode}`);
            
            // Başarı mesajı gönder
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `✅ Telegram hesabınız başarıyla doğrulandı! Artık COINOTAG hesabınızdan bildirimler alabilirsiniz.`
              })
            });
          } else {
            console.log(`❌ Verification failed for code: ${verificationCode} - ${verifyResult.error}`);
            
            // Hata mesajı gönder
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `❌ Doğrulama başarısız: ${verifyResult.error}`
              })
            });
          }
        } catch (apiError) {
          console.error(`🚨 API call failed for verification ${verificationCode}:`, apiError);
        }
      }
    }
  } catch (error) {
    console.error('🚨 Error processing verifications:', error);
  }
}

// Ana döngü
async function startProcessor() {
  while (true) {
    await processVerifications();
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 saniye bekle
  }
}

startProcessor(); 