import React from 'react';

export default function SocialFollowSection() {
  return (
    <section className="py-16">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Sosyal Medyada Bizi Takip Edin</h2>
          <p className="text-muted-foreground text-lg">
            En güncel kripto para haberlerini kaçırmayın
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <a 
            href="https://twitter.com/coinotag" 
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-500 hover:bg-blue-600 text-white p-8 rounded-xl text-center transition-colors"
          >
            <div className="text-4xl mb-4">🐦</div>
            <h3 className="text-xl font-semibold mb-2">Twitter</h3>
            <p className="opacity-90">@coinotag</p>
          </a>
          
          <a 
            href="https://t.me/coinotag" 
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-600 hover:bg-blue-700 text-white p-8 rounded-xl text-center transition-colors"
          >
            <div className="text-4xl mb-4">📱</div>
            <h3 className="text-xl font-semibold mb-2">Telegram</h3>
            <p className="opacity-90">@coinotag</p>
          </a>
          
          <a 
            href="/haber" 
            className="bg-green-500 hover:bg-green-600 text-white p-8 rounded-xl text-center transition-colors"
          >
            <div className="text-4xl mb-4">📰</div>
            <h3 className="text-xl font-semibold mb-2">Haberler</h3>
            <p className="opacity-90">En son haberler</p>
          </a>
        </div>
      </div>
    </section>
  );
} 