#!/usr/bin/env node

/**
 * 🚀 VERCEL MCP SERVER SETUP
 * Coinotag Projects Environment Variables Management
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class VercelMCP {
  constructor() {
    this.projects = [
      { name: 'coinotag', domain: 'coinotag.com' },
      { name: 'coinotag-news', domain: 'coinotag.news' }
    ];
    
    this.envVars = {
      'NEXT_PUBLIC_API_URL': 'https://api.coinotag.com',
      'NEXT_PUBLIC_APP_NAME': 'COINOTAG',
      'NEXT_PUBLIC_APP_VERSION': '1.0.0',
      'NEXT_PUBLIC_ENVIRONMENT': 'production'
    };
  }

  // 🔍 Vercel projelerini listele
  async listProjects() {
    try {
      console.log('🔍 Vercel projelerini listeleniyor...');
      const { stdout } = await execAsync('vercel ls');
      console.log(stdout);
      return stdout;
    } catch (error) {
      console.error('❌ Vercel proje listesi alınamadı:', error.message);
    }
  }

  // 🌍 Environment Variables'ları ayarla
  async setEnvironmentVariables(projectName) {
    console.log(`\n🌍 ${projectName} için environment variables ayarlanıyor...`);
    
    for (const [key, value] of Object.entries(this.envVars)) {
      try {
        // Production, Preview, Development için ayarla
        const environments = ['production', 'preview', 'development'];
        
        for (const env of environments) {
          const command = `vercel env add ${key} ${env} --project=${projectName}`;
          console.log(`⚙️  ${key} = ${value} (${env})`);
          
          // Interactive olarak value gir
          const process = require('child_process').spawn('vercel', ['env', 'add', key, env, `--project=${projectName}`], {
            stdio: ['pipe', 'inherit', 'inherit']
          });
          
          process.stdin.write(value + '\n');
          process.stdin.end();
          
          await new Promise((resolve) => {
            process.on('close', resolve);
          });
        }
        
        console.log(`✅ ${key} başarıyla ayarlandı`);
      } catch (error) {
        console.log(`⚠️  ${key} ayarlanamadı (muhtemelen zaten var):`, error.message);
      }
    }
  }

  // 📋 Mevcut environment variables'ları listele
  async listEnvironmentVariables(projectName) {
    try {
      console.log(`\n📋 ${projectName} environment variables:`);
      const { stdout } = await execAsync(`vercel env ls --project=${projectName}`);
      console.log(stdout);
      return stdout;
    } catch (error) {
      console.error(`❌ ${projectName} env vars listelenemedi:`, error.message);
    }
  }

  // 🚀 Projeyi redeploy et
  async redeployProject(projectName) {
    try {
      console.log(`\n🚀 ${projectName} redeploy ediliyor...`);
      const { stdout } = await execAsync(`vercel --project=${projectName} --prod`);
      console.log(stdout);
      console.log(`✅ ${projectName} başarıyla redeploy edildi!`);
      return stdout;
    } catch (error) {
      console.error(`❌ ${projectName} redeploy edilemedi:`, error.message);
    }
  }

  // 🔧 Belirli environment variable'ı güncelle
  async updateEnvironmentVariable(projectName, key, newValue) {
    try {
      console.log(`\n🔧 ${projectName} - ${key} güncelleniyor: ${newValue}`);
      
      // Önce sil
      await execAsync(`vercel env rm ${key} production --project=${projectName} --yes`);
      await execAsync(`vercel env rm ${key} preview --project=${projectName} --yes`);
      await execAsync(`vercel env rm ${key} development --project=${projectName} --yes`);
      
      // Sonra ekle
      await this.setEnvironmentVariable(projectName, key, newValue);
      
      console.log(`✅ ${key} başarıyla güncellendi`);
    } catch (error) {
      console.log(`⚠️  ${key} güncellenemedi:`, error.message);
    }
  }

  // 🎯 Tek environment variable ayarla
  async setEnvironmentVariable(projectName, key, value) {
    const environments = ['production', 'preview', 'development'];
    
    for (const env of environments) {
      const process = require('child_process').spawn('vercel', ['env', 'add', key, env, `--project=${projectName}`], {
        stdio: ['pipe', 'inherit', 'inherit']
      });
      
      process.stdin.write(value + '\n');
      process.stdin.end();
      
      await new Promise((resolve) => {
        process.on('close', resolve);
      });
    }
  }

  // 🩺 Proje health check
  async healthCheck(domain) {
    try {
      console.log(`\n🩺 ${domain} health check...`);
      const { stdout } = await execAsync(`curl -I https://${domain}`);
      console.log(stdout);
      
      // API bağlantısı test et
      const { stdout: apiTest } = await execAsync(`curl -I https://api.coinotag.com/health`);
      console.log('🔗 API Health:', apiTest);
      
      return stdout;
    } catch (error) {
      console.error(`❌ ${domain} health check başarısız:`, error.message);
    }
  }

  // 🚀 Tam kurulum çalıştır
  async fullSetup() {
    console.log('🚀 COINOTAG VERCEL MCP SETUP BAŞLIYOR...\n');
    
    // 1. Projeleri listele
    await this.listProjects();
    
    // 2. Her proje için setup
    for (const project of this.projects) {
      console.log(`\n🎯 ${project.name} (${project.domain}) işleniyor...`);
      
      // Environment variables'ları ayarla
      await this.setEnvironmentVariables(project.name);
      
      // Mevcut env vars'ları listele
      await this.listEnvironmentVariables(project.name);
      
      // Health check
      await this.healthCheck(project.domain);
      
      // Redeploy
      await this.redeployProject(project.name);
    }
    
    console.log('\n🎉 TÜM İŞLEMLER TAMAMLANDI!');
    console.log('✅ Environment variables ayarlandı');
    console.log('✅ Projeler redeploy edildi');
    console.log('✅ Health check yapıldı');
    console.log('\n🌐 Test edilecek URLler:');
    console.log('- https://coinotag.com');
    console.log('- https://coinotag.news');
    console.log('- https://api.coinotag.com/health');
  }

  // 🔧 Sadece environment variables'ları düzelt
  async fixEnvironmentVariables() {
    console.log('🔧 ENVIRONMENT VARIABLES DÜZELTİLİYOR...\n');
    
    for (const project of this.projects) {
      console.log(`\n🎯 ${project.name} environment variables düzeltiliyor...`);
      
      // API URL'yi düzelt
      await this.updateEnvironmentVariable(project.name, 'NEXT_PUBLIC_API_URL', 'https://api.coinotag.com');
      
      // Listelemeyi göster
      await this.listEnvironmentVariables(project.name);
    }
  }
}

// 🎮 CLI Interface
if (require.main === module) {
  const vercelMCP = new VercelMCP();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      vercelMCP.fullSetup();
      break;
    case 'fix-env':
      vercelMCP.fixEnvironmentVariables();
      break;
    case 'list':
      vercelMCP.listProjects();
      break;
    case 'health':
      const domain = process.argv[3] || 'coinotag.com';
      vercelMCP.healthCheck(domain);
      break;
    default:
      console.log(`
🚀 COINOTAG VERCEL MCP SERVER

Kullanım:
  node vercel-mcp-setup.js [komut]

Komutlar:
  setup     - Tam kurulum (env vars + redeploy)
  fix-env   - Sadece environment variables'ları düzelt
  list      - Vercel projelerini listele
  health    - Health check (domain opsiyonel)

Örnekler:
  node vercel-mcp-setup.js setup
  node vercel-mcp-setup.js fix-env
  node vercel-mcp-setup.js health coinotag.news
      `);
  }
}

module.exports = VercelMCP; 