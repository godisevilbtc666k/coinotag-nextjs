const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// State management
let lastUpdateId = 703632340; // Start from current + 1

console.log('🤖 Telegram verification processor started...');

async function getUpdates() {
  try {
    console.log(`📡 Checking updates from offset: ${lastUpdateId}`);
    
    const url = `${BASE_URL}/getUpdates?offset=${lastUpdateId}&limit=10&timeout=10`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.ok) {
      console.error('❌ Error getting updates:', data.description);
      return [];
    }
    
    console.log(`📥 Received ${data.result.length} updates`);
    return data.result;
  } catch (error) {
    console.error('❌ Fetch error:', error.message);
    return [];
  }
}

async function sendMessage(chatId, text) {
  try {
    const url = `${BASE_URL}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log(`✅ Message sent to ${chatId}`);
    } else {
      console.error(`❌ Failed to send message:`, result.description);
    }
  } catch (error) {
    console.error('❌ Send message error:', error.message);
  }
}

async function processMessage(update) {
  const message = update.message;
  if (!message || !message.text) return;
  
  const chatId = message.chat.id;
  const text = message.text.trim();
  const userId = message.from.id;
  
  console.log(`💬 Message from ${userId}: "${text}"`);
  
  // Handle /start command
  if (text === '/start') {
    const welcomeText = `🚀 <b>COINOTAG Bot'a Hoş Geldiniz!</b>

📱 <b>Mevcut Komutlar:</b>
• <code>/verify KOD</code> - Telegram hesabınızı doğrulayın
• <code>/alerts</code> - Fiyat alarmlarınızı görün
• <code>/news</code> - Son dakika kripto haberlerini alın
• <code>/help</code> - Yardım menüsü

💎 Coinotag hesabınızı bağlamak için web sitesinden doğrulama kodu alın ve buraya <code>/verify KOD</code> şeklinde gönderin.

🔔 Doğrulama sonrası otomatik bildirimleriniz başlayacak!`;
    
    await sendMessage(chatId, welcomeText);
    return;
  }
  
  // Handle /help command
  if (text === '/help') {
    const helpText = `🆘 <b>COINOTAG Bot Yardım</b>

📋 <b>Komut Listesi:</b>
• <code>/verify KOD</code> - Hesap doğrulama
• <code>/alerts</code> - Aktif alarmlarınız
• <code>/news</code> - Güncel kripto haberleri
• <code>/status</code> - Bağlantı durumunuz

💡 <b>Nasıl Kullanılır:</b>
1. coinotag.com'dan kayıt olun
2. Profil → Telegram Ayarları
3. Doğrulama kodu alın
4. Buraya <code>/verify KOD</code> gönderin

❓ Sorun mu yaşıyorsunuz? @coinotag_support ile iletişime geçin.`;
    
    await sendMessage(chatId, helpText);
    return;
  }
  
  // Handle /status command
  if (text === '/status') {
    // Check if user is verified
    try {
      const response = await fetch('http://localhost:3000/api/telegram/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chatId.toString() })
      });
      
      const result = await response.json();
      
      if (result.verified) {
        const statusText = `✅ <b>Hesap Durumu: Doğrulanmış</b>

👤 Kullanıcı ID: <code>${result.userId}</code>
🔔 Bildirimler: Aktif
📱 Son Aktivite: ${result.lastActivity || 'Bilinmiyor'}

🎯 <b>Mevcut Özellikler:</b>
• Fiyat alarmları
• Son dakika haberleri
• Piyasa analizleri`;
        
        await sendMessage(chatId, statusText);
      } else {
        await sendMessage(chatId, '❌ <b>Hesap doğrulanmamış!</b>\n\nLütfen coinotag.com üzerinden doğrulama kodunuzu alın ve <code>/verify KOD</code> gönderin.');
      }
    } catch (error) {
      await sendMessage(chatId, '⚠️ Durum kontrol edilemedi. Lütfen daha sonra tekrar deneyin.');
    }
    return;
  }
  
  // Handle /alerts command  
  if (text === '/alerts') {
    await sendMessage(chatId, '🔔 <b>Fiyat Alarmları</b>\n\nBu özellik yakında aktif olacak! Web sitesinden alarm kurabilirsiniz.');
    return;
  }
  
  // Handle /news command
  if (text === '/news') {
    await sendMessage(chatId, '📰 <b>Son Dakika Haberleri</b>\n\nGüncel kripto haberlerini coinotag.com üzerinden takip edebilirsiniz. Otomatik haber bildirimleri yakında!');
    return;
  }
  
  // Check if it's a verification command
  const verifyMatch = text.match(/^\/verify\s+([A-Z0-9]{6})$/i);
  if (!verifyMatch) {
    // Unknown command
    await sendMessage(chatId, '❓ <b>Bilinmeyen komut!</b>\n\nKullanılabilir komutlar için <code>/help</code> yazın.');
    return;
  }
  
  const code = verifyMatch[1].toUpperCase();
  console.log(`🔍 Processing verification code: ${code} for chat ${chatId}`);
  
  try {
    // Call our manual verification API
    const response = await fetch('http://localhost:3000/api/telegram/manual-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        chatId: chatId.toString()
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Verification successful for code ${code}`);
      const successText = `✅ <b>Telegram hesabınız başarıyla doğrulandı!</b>

🎉 Tebrikler! Artık aşağıdaki özelliklere erişebilirsiniz:

🔔 <b>Fiyat Alarmları:</b> Belirlediğiniz seviyelerde bildirim
📰 <b>Son Dakika Haberleri:</b> Otomatik haber güncellemeleri  
📊 <b>Piyasa Analizleri:</b> Günlük piyasa özetleri

💡 <b>Komutlar:</b>
• <code>/alerts</code> - Alarmlarınızı görün
• <code>/news</code> - Haberleri kontrol edin
• <code>/status</code> - Hesap durumunuz

🚀 Coinotag Premium'a geçerek daha fazla özellik açın!`;
      
      await sendMessage(chatId, successText);
    } else {
      console.log(`❌ Verification failed for code ${code}: ${result.message}`);
      await sendMessage(chatId, `❌ <b>Doğrulama başarısız!</b>

🔍 <b>Olası nedenler:</b>
• Kod geçersiz veya süresi dolmuş
• Kod zaten kullanılmış
• Sistem hatası

💡 <b>Çözüm:</b>
1. coinotag.com → Profil → Telegram Ayarları
2. Yeni doğrulama kodu alın
3. <code>/verify YENİKOD</code> gönderin

❓ Sorun devam ederse @coinotag_support ile iletişime geçin.`);
    }
  } catch (error) {
    console.error(`❌ API call failed for code ${code}:`, error.message);
    await sendMessage(chatId, '❌ <b>Sistem hatası!</b>\n\nSunucuya bağlanılamıyor. Lütfen daha sonra tekrar deneyin veya @coinotag_support ile iletişime geçin.');
  }
}

async function main() {
  try {
    const updates = await getUpdates();
    
    for (const update of updates) {
      await processMessage(update);
      lastUpdateId = update.update_id + 1;
    }
    
    // Wait 5 seconds before next check
    setTimeout(main, 5000);
  } catch (error) {
    console.error('❌ Main loop error:', error.message);
    setTimeout(main, 5000);
  }
}

// Start the process
main(); 