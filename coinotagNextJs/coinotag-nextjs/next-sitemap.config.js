/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || 'https://coinotag.com',
  generateRobotsTxt: true,
  sitemapSize: 7000,
  changefreq: 'daily',
  priority: 0.7,
  exclude: [
    '/api/*',
    '/auth/*',
    '/profil',
    '/ayarlar',
    '/ayarlar/*',
    '/alarmlar',
    '/payment/*',
    '/test-notifications'
  ],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth/',
          '/profil',
          '/ayarlar/',
          '/alarmlar',
          '/payment/',
          '/test-notifications'
        ]
      }
    ],
    additionalSitemaps: [
      'https://coinotag.com/sitemap.xml'
    ]
  },
  transform: async (config, path) => {
    // Kripto para sayfaları için özel öncelik
    if (path.includes('/kripto-paralar/')) {
      return {
        loc: path,
        changefreq: 'hourly',
        priority: 0.9,
        lastmod: new Date().toISOString()
      }
    }

    // Ana sayfa için yüksek öncelik
    if (path === '/') {
      return {
        loc: path,
        changefreq: 'hourly',
        priority: 1.0,
        lastmod: new Date().toISOString()
      }
    }

    // Haber sayfaları için
    if (path.includes('/sondakikahaberleri/') || path.includes('/haber/')) {
      return {
        loc: path,
        changefreq: 'daily',
        priority: 0.8,
        lastmod: new Date().toISOString()
      }
    }

    return {
      loc: path,
      changefreq: config.changefreq,
      priority: config.priority,
      lastmod: new Date().toISOString()
    }
  }
} 