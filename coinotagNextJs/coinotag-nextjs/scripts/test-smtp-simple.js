const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransporter({
  host: 'smtp.yandex.com',
  port: 465,
  secure: true,
  auth: {
    user: 'noreply@coinotag.com',
    pass: process.env.SMTP_PASSWORD || 'your-password-here'
  }
});

async function testSMTP() {
  try {
    console.log('📧 Testing SMTP connection...');
    
    // SMTP bağlantı testi
    await transporter.verify();
    console.log('✅ SMTP connection verified');
    
    // Test mail gönder
    const info = await transporter.sendMail({
      from: 'noreply@coinotag.com',
      to: 'coinotag@gmail.com',
      subject: 'SMTP Test - Direct NodeJS',
      html: `
        <h2>SMTP Test Email</h2>
        <p>Bu email doğrudan NodeJS/Nodemailer ile gönderilmiştir.</p>
        <p>Timestamp: ${new Date().toISOString()}</p>
      `
    });
    
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    
  } catch (error) {
    console.error('❌ SMTP Error:', error);
    console.error('Error code:', error.code);
    console.error('Error command:', error.command);
  }
}

testSMTP(); 