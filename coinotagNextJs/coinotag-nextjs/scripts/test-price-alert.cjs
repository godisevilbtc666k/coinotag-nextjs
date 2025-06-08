#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// .env dosyasını yükle
const envPath = path.join(__dirname, '../coinotag/.env.local');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length) {
      process.env[key] = valueParts.join('=');
    }
  });
}

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NEXTJS_URL = process.env.NEXTJS_URL || 'http://localhost:3000';

console.log('🚀 COINOTAG Gelişmiş Alarm Test Sistemi v2.0');
console.log('=' .repeat(50));

// Test configleri - Gerçek API fiyatlarıyla dinamik
async function getTestConfigs() {
  const configs = [];
  
  try {
    // BTC fiyatı çek
    const btcResponse = await makeRequest('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const btcData = await btcResponse.json();
    const btcPrice = parseFloat(btcData.price);
    
    // ETH fiyatı çek  
    const ethResponse = await makeRequest('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
    const ethData = await ethResponse.json();
    const ethPrice = parseFloat(ethData.price);
    
    // BNB fiyatı çek
    const bnbResponse = await makeRequest('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
    const bnbData = await bnbResponse.json();
    const bnbPrice = parseFloat(bnbData.price);
    
    configs.push({
      name: 'Bitcoin Spot Alarm (Sürekli)',
      symbol: 'BTC',
      targetPrice: Math.round(btcPrice - 100), // Mevcut fiyattan 100$ düşük
      currentPrice: btcPrice,
      alertType: 'PRICE_ABOVE',
      marketType: 'spot',
      isRecurring: true,
      notifications: ['telegram', 'email', 'push']
    });
    
    configs.push({
      name: 'Ethereum Futures Alarm (Tek Seferlik)', 
      symbol: 'ETH',
      targetPrice: Math.round(ethPrice - 50), // Mevcut fiyattan 50$ düşük
      currentPrice: ethPrice,
      alertType: 'PRICE_ABOVE',
      marketType: 'futures',
      isRecurring: false,
      notifications: ['telegram', 'push']
    });
    
    configs.push({
      name: 'BNB Destek Kırılımı (Sürekli)',
      symbol: 'BNB', 
      targetPrice: Math.round(bnbPrice + 10), // Mevcut fiyattan 10$ yüksek
      currentPrice: bnbPrice - 1, // 1$ düşük (kırılım simülasyonu)
      alertType: 'SUPPORT_BREAK',
      marketType: 'spot',
      isRecurring: true,
      notifications: ['email', 'push']
    });
    
    console.log('📊 Gerçek fiyatlar:');
    console.log(`🟡 BTC: $${btcPrice.toLocaleString()}`);
    console.log(`🟡 ETH: $${ethPrice.toLocaleString()}`);
    console.log(`🟡 BNB: $${bnbPrice.toLocaleString()}\n`);
    
  } catch (error) {
    console.log('⚠️ API hatası, fallback değerler kullanılıyor:', error.message);
    // Fallback static values
    configs.push({
      name: 'Bitcoin Spot Alarm (Sürekli - Fallback)',
      symbol: 'BTC',
      targetPrice: 95000,
      currentPrice: 95001,
      alertType: 'PRICE_ABOVE',
      marketType: 'spot',
      isRecurring: true,
      notifications: ['telegram', 'email', 'push']
    });
  }
  
  return configs;
}

// Telegram Chat ID'leri
const TELEGRAM_CHATS = [
  5854110093, // coinotagape
  // Başka test chat'leri buraya ekleyebilirsin
];

// Telegram notification gönder
async function sendTelegramNotification(config) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN yok, Telegram testi atlanıyor');
    return;
  }

  // Profesyonel trading mesajı formatı
  const isPositive = config.currentPrice >= config.targetPrice;
  const priceEmoji = isPositive ? '🟢' : '🔴';
  const directionEmoji = config.alertType === 'PRICE_ABOVE' ? '🚀' : '📉';
  const marketEmoji = config.marketType === 'futures' ? '⚡' : '💎';
  const recurringEmoji = config.isRecurring ? '🔄' : '🎯';
  
  // Price change calculation
  const priceChange = ((config.currentPrice - config.targetPrice) / config.targetPrice * 100).toFixed(2);
  const changeEmoji = priceChange >= 0 ? '🟢' : '🔴';
  const changeText = priceChange >= 0 ? `+${priceChange}%` : `${priceChange}%`;
  
  const message = `${directionEmoji} *${config.symbol}USDT Alarm Tetiklendi* ${recurringEmoji}

${marketEmoji} *Market:* ${config.marketType.toUpperCase()}
${priceEmoji} *Fiyat:* $${config.currentPrice.toLocaleString()} 
🎯 *Hedef:* $${config.targetPrice.toLocaleString()}
${changeEmoji} *Değişim:* ${changeText}
⏰ *Tip:* ${config.isRecurring ? 'Sürekli İzleme' : 'Tek Seferlik'}

📈 *COINOTAG Alert System*
_Profesyonel kripto takip platformu_

🔔 Bu ${config.isRecurring ? 'sürekli alarm her dakika kontrol edilecek' : 'alarm artık pasif durumda'}`;

  for (const chatId of TELEGRAM_CHATS) {
    try {
      const response = await makeRequest(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });

      if (response.ok) {
        console.log(`✅ Telegram gönderildi (Chat: ${chatId})`);
      } else {
        console.log(`❌ Telegram başarısız (Chat: ${chatId}):`, response.statusText);
      }
    } catch (error) {
      console.log(`❌ Telegram hatası (Chat: ${chatId}):`, error.message);
    }
  }
}

// Email notification gönder
async function sendEmailNotification(config) {
  try {
    // Profesyonel email için daha detaylı veri
    const isPositive = config.currentPrice >= config.targetPrice;
    const direction = config.alertType === 'PRICE_ABOVE' ? 'yukarı kırılım' : 'aşağı kırılım';
    const marketType = config.marketType === 'futures' ? 'Vadeli İşlem' : 'Spot';
    const priceChange = ((config.currentPrice - config.targetPrice) / config.targetPrice * 100).toFixed(2);
    const changeText = priceChange >= 0 ? `+${priceChange}%` : `${priceChange}%`;
    
    // Doğrudan NodeMailer kullan
    const transporter = nodemailer.createTransport({
      host: 'smtp.yandex.com',
      port: 465,
      secure: true,
      auth: {
        user: 'noreply@coinotag.com',
        pass: process.env.YANDEX_SMTP_PASSWORD || process.env.SMTP_PASSWORD || 'fallback_password'
      }
    });

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>COINOTAG Alert Test</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; background: #f8f9fa;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <div style="background: #000; color: white; padding: 32px; text-align: center;">
            <img src="https://coinotag.com/wp-content/uploads/2024/11/CO-CoinOtag-White.png" style="height: 40px; margin-bottom: 16px;">
            <h1 style="margin: 0; font-size: 24px;">Test Price Alert</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #000; margin-bottom: 16px;">${config.symbol}/USDT ${marketType}</h2>
            <div style="background: #f8f9fa; border: 1px solid #000; padding: 16px; border-radius: 6px; margin-bottom: 24px; text-align: center;">
              ${direction} Tespit Edildi
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
              <div style="text-align: center; background: #f8f9fa; padding: 16px; border-radius: 6px;">
                <div style="font-size: 12px; color: #666; margin-bottom: 8px;">GÜNCEL FİYAT</div>
                <div style="font-size: 20px; font-weight: bold;">$${config.currentPrice.toLocaleString()}</div>
              </div>
              <div style="text-align: center; background: #f8f9fa; padding: 16px; border-radius: 6px;">
                <div style="font-size: 12px; color: #666; margin-bottom: 8px;">HEDEF FİYAT</div>
                <div style="font-size: 20px; font-weight: bold;">$${config.targetPrice.toLocaleString()}</div>
              </div>
            </div>
            <div style="text-align: center; background: #f8f9fa; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
              <strong>Değişim:</strong> ${changeText} | <strong>Tip:</strong> ${config.isRecurring ? 'Sürekli' : 'Tek Seferlik'}
            </div>
            <div style="text-align: center;">
              <a href="https://coinotag.com/kripto-paralar${config.marketType === 'futures' ? '/futures' : ''}/${config.symbol.toLowerCase()}" 
                 style="background: white; color: black; border: 2px solid black; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                ${config.symbol} Detaylarını Görüntüle
              </a>
            </div>
          </div>
          <div style="background: #000; color: white; padding: 24px; text-align: center;">
            <div style="color: rgba(255,255,255,0.8); font-size: 14px;">COINOTAG - Profesyonel Kripto Para Analiz Platformu</div>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: 'noreply@coinotag.com',
      to: 'test@coinotag.com',
      subject: `TEST: ${config.symbol} Fiyat Alarmı - COINOTAG`,
      html: emailHtml,
      text: `COINOTAG Test Alert\n\n${config.symbol}/USDT ${marketType}\nGüncel: $${config.currentPrice}\nHedef: $${config.targetPrice}\nDeğişim: ${changeText}\nTip: ${config.isRecurring ? 'Sürekli' : 'Tek Seferlik'}`
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email gönderildi:', result.messageId);
    
  } catch (error) {
    console.log('❌ Email hatası:', error.message);
  }
}

// Push notification test (konsol simülasyonu)
async function sendPushNotification(config) {
  // Profesyonel push notification formatı  
  const priceEmoji = config.currentPrice >= config.targetPrice ? '🟢' : '🔴';
  const directionEmoji = config.alertType === 'PRICE_ABOVE' ? '🚀' : '📉';
  const marketEmoji = config.marketType === 'futures' ? '⚡' : '💎';
  const recurringEmoji = config.isRecurring ? '🔄' : '🎯';
  const priceChange = ((config.currentPrice - config.targetPrice) / config.targetPrice * 100).toFixed(2);
  const changeText = priceChange >= 0 ? `+${priceChange}%` : `${priceChange}%`;
  
  console.log('\n📱 PUSH NOTIFICATION PREVIEW:');
  console.log('='  .repeat(40));
  console.log(`🔔 ${directionEmoji} ${config.symbol}USDT Alert ${recurringEmoji}`);
  console.log(`${priceEmoji} $${config.currentPrice.toLocaleString()} ${marketEmoji} (${changeText})`);
  console.log(`Target: $${config.targetPrice.toLocaleString()} | ${config.marketType.toUpperCase()}`);
  console.log(`${config.isRecurring ? '(Sürekli İzleme - 1dk)' : '(Tek Seferlik)'}`);
  console.log('');
  console.log('🔊 Özellikler:');
  console.log('• Ses: /sounds/alert-sound.mp3');
  console.log('• Vibrasyon: 200ms-100ms-200ms');
  console.log('• Kalıcı: Evet (sticky: true)');
  console.log('• Aksiyonlar: [Detay Görüntüle] [5dk Ertele] [Kapat]');
  console.log('='  .repeat(40));
  console.log('✅ Push notification önizlemesi tamamlandı\n');
}

// HTTP request helper
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          json: () => JSON.parse(data)
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// Test süreci
async function runTests() {
  const args = process.argv.slice(2);
  const testType = args[0] || 'all';
  
  console.log(`🎯 Test Tipi: ${testType.toUpperCase()}`);
  console.log('');

  const testConfigs = await getTestConfigs();

  for (let i = 0; i < testConfigs.length; i++) {
    const config = testConfigs[i];
    
    console.log(`\n${i + 1}. ${config.name}`);
    console.log('-'.repeat(30));
    
    if (testType === 'all' || testType === 'telegram') {
      if (config.notifications.includes('telegram')) {
        await sendTelegramNotification(config);
      }
    }
    
    if (testType === 'all' || testType === 'email') {
      if (config.notifications.includes('email')) {
        await sendEmailNotification(config);
      }
    }
    
    if (testType === 'all' || testType === 'push') {
      if (config.notifications.includes('push')) {
        await sendPushNotification(config);
      }
    }
    
    // Test'ler arası kısa bekleme
    if (i < testConfigs.length - 1) {
      console.log('\n⏳ 2 saniye bekleniyor...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Monitör modu - Gerçek zamanlı fiyat kontrolü
async function runMonitor() {
  console.log('📊 GERÇEK ZAMANLI ALARM MONİTÖRÜ');
  console.log('🔄 Sürekli alarmlar için 1 dakika interval');
  console.log('Ctrl+C ile durdurun\n');
  
  const symbols = ['BTC', 'ETH', 'BNB'];
  
  // İlk çalıştırımda alarm threshold'larını belirle
  const alarmThresholds = {};
  for (const symbol of symbols) {
    try {
      const response = await makeRequest(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
      const data = await response.json();
      const currentPrice = parseFloat(data.price);
      
      // Dinamik threshold'lar - mevcut fiyatın %2 üzerinde alarm
      alarmThresholds[symbol] = {
        target: Math.round(currentPrice * 1.02), // %2 artış
        lastAlerted: 0 // Son alarm zamanı
      };
      
      console.log(`🎯 ${symbol} alarm seviyesi: $${alarmThresholds[symbol].target.toLocaleString()} (mevcut: $${currentPrice.toLocaleString()})`);
    } catch (error) {
      console.log(`❌ ${symbol} threshold hatası:`, error.message);
      // Fallback static thresholds
      alarmThresholds[symbol] = {
        target: symbol === 'BTC' ? 95000 : symbol === 'ETH' ? 2700 : 700,
        lastAlerted: 0
      };
    }
  }
  
  console.log(''); // Boş satır
  
  setInterval(async () => {
    console.log(`⏰ ${new Date().toLocaleTimeString()} - Fiyat kontrolü...`);
    
    for (const symbol of symbols) {
      try {
        const response = await makeRequest(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
        const data = await response.json();
        const price = parseFloat(data.price);
        
        // 24h değişim bilgisi al
        const ticker24hResponse = await makeRequest(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
        const ticker24hData = await ticker24hResponse.json();
        const change24h = parseFloat(ticker24hData.priceChangePercent);
        const changeEmoji = change24h >= 0 ? '🟢' : '🔴';
        
        console.log(`${changeEmoji} ${symbol}: $${price.toLocaleString()} (${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%)`);
        
        // Dinamik alarm kontrolü - threshold'u geçen herhangi bir coin
        const threshold = alarmThresholds[symbol];
        const now = Date.now();
        
        if (price > threshold.target && (now - threshold.lastAlerted) > 300000) { // 5dk cooldown
          console.log(`🚀 ALARM TETİKLENDİ: ${symbol} hedef seviyeyi kırdı! ($${threshold.target.toLocaleString()})`);
          
          // Cooldown ayarla
          threshold.lastAlerted = now;
          
          const alarmConfig = {
            symbol: symbol,
            targetPrice: threshold.target,
            currentPrice: price,
            alertType: 'PRICE_ABOVE',
            marketType: 'spot',
            isRecurring: true,
            notifications: ['telegram', 'email']
          };
          
          // Telegram gönder
          await sendTelegramNotification(alarmConfig);
          
          // Email gönder
          await sendEmailNotification(alarmConfig);
        }
      } catch (error) {
        console.log(`❌ ${symbol} fiyat hatası:`, error.message);
      }
    }
    
    console.log(''); // Boş satır
  }, 60000); // 1 dakikada bir - Sürekli alarmlar için
}

// Ana fonksiyon
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'monitor':
      await runMonitor();
      break;
    case 'telegram':
    case 'email':
    case 'push':
      await runTests();
      break;
    default:
      console.log('📋 Kullanım:');
      console.log('node scripts/test-price-alert.cjs [komut]');
      console.log('');
      console.log('Komutlar:');
      console.log('  telegram  - Sadece Telegram testleri');
      console.log('  email     - Sadece Email testleri');
      console.log('  push      - Sadece Push testleri');
      console.log('  monitor   - Gerçek zamanlı monitör');
      console.log('  (boş)     - Tüm testler');
      console.log('');
      await runTests();
  }
}

// Ctrl+C handler
process.on('SIGINT', () => {
  console.log('\n\n👋 Test sistemi durduruluyor...');
  process.exit(0);
});

// Çalıştır
main().catch(console.error); 