import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/// <reference lib="deno.ns" />

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  alertData?: {
    symbol: string;
    alertType: string;
    currentPrice: number;
    conditionValue: number;
    marketType: string;
    userName?: string;
    timestamp: string;
  };
}

// Declare Deno globally (Edge Function runtime provides this)
declare const Deno: any;

// SMTP Konfigürasyonu (Yandex Mail) - PRODUCTION SETTINGS
const SMTP_CONFIG = {
  hostname: 'smtp.yandex.com',
  port: 465,
  username: 'noreply@coinotag.com',
  password: Deno.env.get('SMTP_PASSWORD') || '', // Secret'ten alınacak
  secure: true // SSL/TLS
};

// HTML Email Template
function createAlertEmailTemplate(data: {
  symbol: string;
  alertType: string;
  currentPrice: number;
  conditionValue: number;
  marketType: string;
  userName?: string;
  timestamp: string;
}) {
  const isAbove = data.alertType.includes('ABOVE') || data.alertType === 'RESISTANCE_BREAK';
  const direction = isAbove ? 'Yukarı Yönlü' : 'Aşağı Yönlü';
  const directionColor = isAbove ? '#16a34a' : '#dc2626';
  const marketBadge = data.marketType === 'futures' ? 'Vadeli İşlem' : 'Spot';
  
  const isBreakAlert = data.alertType === 'SUPPORT_BREAK' || data.alertType === 'RESISTANCE_BREAK';
  const breakType = data.alertType === 'SUPPORT_BREAK' ? 'Destek' : 'Direnç';
  
  if (isBreakAlert) {
    // Support/Resistance break template
    const breakColor = data.alertType === 'SUPPORT_BREAK' ? '#dc2626' : '#16a34a';
    
    return `
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.symbol} ${breakType} Seviyesi Kırıldı - COINOTAG</title>
    <style>
      body { 
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; 
        margin: 0; 
        padding: 0;
        background: #f8fafc;
        color: #334155;
        line-height: 1.6;
      }
      .container { 
        max-width: 600px; 
        margin: 40px auto; 
        background: #ffffff; 
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        border: 1px solid #e2e8f0;
      }
      .header { 
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
        color: white; 
        padding: 32px 40px; 
        text-align: left; 
      }
      .header h1 { 
        margin: 0; 
        font-size: 24px; 
        font-weight: 600;
        letter-spacing: -0.025em;
      }
      .header .subtitle {
        margin-top: 8px;
        font-size: 16px;
        opacity: 0.9;
        font-weight: 400;
      }
      .content { 
        padding: 40px;
      }
      .alert-info {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 24px;
        margin-bottom: 32px;
      }
      .symbol-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .symbol {
        font-size: 20px;
        font-weight: 700;
        color: #1e293b;
      }
      .market-type {
        background: #f1f5f9;
        color: #475569;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .break-indicator {
        background: ${breakColor};
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        margin-bottom: 24px;
      }
      .price-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 24px;
      }
      .price-item {
        text-align: center;
      }
      .price-label {
        font-size: 12px;
        font-weight: 500;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
      }
      .price-value {
        font-size: 28px;
        font-weight: 700;
        color: #1e293b;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      }
      .current-price {
        color: ${breakColor};
      }
      .level-price {
        color: #64748b;
      }
      .analysis-note {
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 24px;
      }
      .analysis-note p {
        margin: 0;
        color: #9a3412;
        font-size: 14px;
        font-weight: 500;
      }
      .action-section {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 24px;
        text-align: center;
        margin-top: 32px;
      }
      .button { 
        display: inline-block; 
        background: #1e293b;
        color: white; 
        padding: 12px 24px; 
        text-decoration: none; 
        border-radius: 6px; 
        font-weight: 500;
        font-size: 14px;
        transition: background-color 0.2s;
      }
      .button:hover {
        background: #334155;
      }
      .footer { 
        background: #f8fafc; 
        padding: 24px 40px; 
        text-align: center; 
        border-top: 1px solid #e2e8f0;
      }
      .footer-content {
        color: #64748b; 
        font-size: 12px;
        line-height: 1.5;
      }
      .footer-links {
        margin-top: 16px;
      }
      .footer-links a {
        color: #475569;
        text-decoration: none;
        margin: 0 8px;
        font-weight: 500;
      }
      .timestamp {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 16px;
      }
      @media (max-width: 600px) {
        .container { margin: 20px; }
        .header, .content { padding: 24px; }
        .price-section { grid-template-columns: 1fr; gap: 16px; }
        .price-value { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Teknik Seviye Kırılımı</h1>
        <div class="subtitle">${breakType} seviyesi tespit edildi</div>
      </div>
      
      <div class="content">
        <div class="alert-info">
          <div class="symbol-row">
            <div class="symbol">${data.symbol}/USDT</div>
            <div class="market-type">${marketBadge}</div>
          </div>
          
          <div class="break-indicator">
            ${breakType} Seviyesi Kırıldı
          </div>
          
          <div class="price-section">
            <div class="price-item">
              <div class="price-label">Güncel Fiyat</div>
              <div class="price-value current-price">
                $${data.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              </div>
            </div>
            <div class="price-item">
              <div class="price-label">${breakType} Seviyesi</div>
              <div class="price-value level-price">
                $${data.conditionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              </div>
            </div>
          </div>
          
          <div class="analysis-note">
            <p><strong>Teknik Analiz:</strong> ${data.symbol} için belirlediğiniz ${breakType.toLowerCase()} seviyesi kırıldı. Bu önemli bir teknik sinyal olabilir.</p>
          </div>
          
          <div class="timestamp">
            Tespit Zamanı: ${new Date(data.timestamp).toLocaleString('tr-TR', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </div>
        </div>
        
        <div class="action-section">
          <p style="margin: 0 0 16px 0; color: #475569; font-size: 14px;">
            Detaylı teknik analiz ve güncel grafikleri görüntülemek için
          </p>
          <a href="https://coinotag.com/kripto-paralar/${data.marketType}/${data.symbol.toLowerCase()}" class="button">
            Teknik Analizi Görüntüle
          </a>
        </div>
      </div>
      
      <div class="footer">
        <div class="footer-content">
          <strong>COINOTAG</strong><br>
          Profesyonel Kripto Para Analiz Platformu
          <div class="footer-links">
            <a href="https://coinotag.com/alarmlar">Alarm Yönetimi</a>
            <a href="https://coinotag.com">Platform</a>
            <a href="https://coinotag.com/destek">Destek</a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
  } else {
    // Price alert template
    return `
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.symbol} Fiyat Alarmı Tetiklendi - COINOTAG</title>
    <style>
      body { 
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; 
        margin: 0; 
        padding: 0;
        background: #f8fafc;
        color: #334155;
        line-height: 1.6;
      }
      .container { 
        max-width: 600px; 
        margin: 40px auto; 
        background: #ffffff; 
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        border: 1px solid #e2e8f0;
      }
      .header { 
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
        color: white; 
        padding: 32px 40px; 
        text-align: left; 
      }
      .header h1 { 
        margin: 0; 
        font-size: 24px; 
        font-weight: 600;
        letter-spacing: -0.025em;
      }
      .header .subtitle {
        margin-top: 8px;
        font-size: 16px;
        opacity: 0.9;
        font-weight: 400;
      }
      .content { 
        padding: 40px;
      }
      .alert-info {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 24px;
        margin-bottom: 32px;
      }
      .symbol-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .symbol {
        font-size: 20px;
        font-weight: 700;
        color: #1e293b;
      }
      .market-type {
        background: #f1f5f9;
        color: #475569;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .price-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 24px;
      }
      .price-item {
        text-align: center;
      }
      .price-label {
        font-size: 12px;
        font-weight: 500;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
      }
      .price-value {
        font-size: 28px;
        font-weight: 700;
        color: #1e293b;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      }
      .current-price {
        color: ${directionColor};
      }
      .target-price {
        color: #64748b;
      }
      .direction-indicator {
        background: ${directionColor};
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        margin-bottom: 24px;
      }
      .action-section {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 24px;
        text-align: center;
        margin-top: 32px;
      }
      .button { 
        display: inline-block; 
        background: #1e293b;
        color: white; 
        padding: 12px 24px; 
        text-decoration: none; 
        border-radius: 6px; 
        font-weight: 500;
        font-size: 14px;
        transition: background-color 0.2s;
      }
      .button:hover {
        background: #334155;
      }
      .footer { 
        background: #f8fafc; 
        padding: 24px 40px; 
        text-align: center; 
        border-top: 1px solid #e2e8f0;
      }
      .footer-content {
        color: #64748b; 
        font-size: 12px;
        line-height: 1.5;
      }
      .footer-links {
        margin-top: 16px;
      }
      .footer-links a {
        color: #475569;
        text-decoration: none;
        margin: 0 8px;
        font-weight: 500;
      }
      .timestamp {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 16px;
      }
      @media (max-width: 600px) {
        .container { margin: 20px; }
        .header, .content { padding: 24px; }
        .price-section { grid-template-columns: 1fr; gap: 16px; }
        .price-value { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Fiyat Alarmı Tetiklendi</h1>
        <div class="subtitle">Belirlediğiniz fiyat seviyesine ulaşıldı</div>
      </div>
      
      <div class="content">
        <div class="alert-info">
          <div class="symbol-row">
            <div class="symbol">${data.symbol}/USDT</div>
            <div class="market-type">${marketBadge}</div>
          </div>
          
          <div class="direction-indicator">
            ${direction} Hareket Tespit Edildi
          </div>
          
          <div class="price-section">
            <div class="price-item">
              <div class="price-label">Güncel Fiyat</div>
              <div class="price-value current-price">
                $${data.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              </div>
            </div>
            <div class="price-item">
              <div class="price-label">Hedef Fiyat</div>
              <div class="price-value target-price">
                $${data.conditionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              </div>
            </div>
          </div>
          
          <div class="timestamp">
            Tetiklenme Zamanı: ${new Date(data.timestamp).toLocaleString('tr-TR', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </div>
        </div>
        
        <div class="action-section">
          <p style="margin: 0 0 16px 0; color: #475569; font-size: 14px;">
            Detaylı analiz ve güncel verilere ulaşmak için
          </p>
          <a href="https://coinotag.com/kripto-paralar/${data.marketType}/${data.symbol.toLowerCase()}" class="button">
            ${data.symbol} Detaylarını Görüntüle
          </a>
        </div>
      </div>
      
      <div class="footer">
        <div class="footer-content">
          <strong>COINOTAG</strong><br>
          Profesyonel Kripto Para Analiz Platformu
          <div class="footer-links">
            <a href="https://coinotag.com/alarmlar">Alarm Yönetimi</a>
            <a href="https://coinotag.com">Platform</a>
            <a href="https://coinotag.com/destek">Destek</a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
  }
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Yandex SMTP Email Gönderme Fonksiyonu
async function sendEmailViaYandex(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; message: string; email_sent: boolean; method: string }> {
  try {
    console.log('🔥 YANDEX SMTP bağlantısı kuruluyor...');
    
    const smtpPassword = Deno.env.get('SMTP_PASSWORD');
    if (!smtpPassword) {
      throw new Error('SMTP_PASSWORD environment variable bulunamadı!');
    }

    console.log('🔐 SMTP Password secrets\'ten alındı');

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.yandex.com",
        port: 465,
        tls: true,
        auth: {
          username: "noreply@coinotag.com",
          password: smtpPassword,
        },
      },
    });

    console.log('📤 Email gönderiliyor...');

    await client.send({
      from: "noreply@coinotag.com",
      to: toEmail,
      subject: subject,
      content: htmlContent,
      html: htmlContent,
    });

    console.log('✅ Email başarıyla gönderildi!');

    return {
      success: true,
      message: 'Email başarıyla gönderildi (Yandex SMTP)',
      email_sent: true,
      method: 'yandex_smtp_success'
    };

  } catch (error) {
    console.error('❌ Yandex SMTP hatası:', error);
    
    return {
      success: false,
      message: `Yandex SMTP hatası: ${(error as Error).message}`,
      email_sent: false,
      method: 'yandex_smtp_failed'
    };
  }
}

// Database log fonksiyonu
async function logEmailToDatabase(data: any, result: any) {
  try {
    const supabaseUrl = 'https://roqgwzdfkibxgvyyfvxj.supabase.co';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error } = await supabase
      .from('email_logs')
      .insert({
        user_email: data.userEmail,
        symbol: data.symbol,
        alert_type: data.alertType,
        current_price: data.currentPrice,
        target_price: data.targetPrice || data.conditionValue,
        market_type: data.marketType,
        email_sent: result.email_sent,
        method_used: result.method,
        response_message: result.message,
        sent_at: new Date().toISOString()
      });

    if (error) {
      console.error('Database log hatası:', error);
    } else {
      console.log('✅ Email log database\'e kaydedildi');
    }
  } catch (err) {
    console.error('Database log exception:', err);
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
    const body = await req.json();
    console.log('📧 Email isteği alındı:', JSON.stringify(body, null, 2));

    if (!body.userEmail || !body.symbol) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'userEmail ve symbol alanları gereklidir',
          timestamp: new Date().toISOString()
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('🔄 Frontend formatı tespit edildi, template oluşturuluyor...');

    const emailData = {
      symbol: body.symbol,
      alertType: body.alertType || 'PRICE_ABOVE',
      currentPrice: body.currentPrice || 0,
      conditionValue: body.targetPrice || body.conditionValue || 0,
      marketType: body.marketType || 'spot',
      userName: body.userName || 'Değerli Kullanıcı',
      timestamp: body.timestamp || new Date().toISOString()
    };

    console.log('📤 Email gönderiliyor:', body.userEmail);

    const htmlContent = createAlertEmailTemplate(emailData);
    const subject = `🚀 ${body.symbol} Fiyat Alarmı - ${body.currentPrice ? `$${body.currentPrice.toLocaleString()}` : 'Güncellendi'}`;

    const result = await sendEmailViaYandex(body.userEmail, subject, htmlContent);

    // Database'e log
    await logEmailToDatabase(body, result);

    const response = {
      ...result,
      timestamp: new Date().toISOString(),
      recipient: body.userEmail,
      symbol: body.symbol
    };

    console.log('📋 Final response:', JSON.stringify(response, null, 2));

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: result.success ? 200 : 500,
      }
    );

  } catch (error) {
    console.error('❌ Email function genel hatası:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        message: `Edge Function hatası: ${(error as Error).message}`,
        timestamp: new Date().toISOString(),
        email_sent: false,
        method: 'function_error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
}); 