import React from 'react';

export default function XBioSection() {
  return (
    <section className="py-16 bg-muted/50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Bizi Takip Edin</h2>
          <p className="text-muted-foreground text-lg">
            En güncel kripto para haberlerini kaçırmayın
          </p>
        </div>
        
        <div className="max-w-2xl mx-auto">
          <div className="bg-card border border-border p-8 rounded-lg text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-white text-2xl font-bold">X</span>
              </div>
              <h3 className="text-2xl font-bold mb-2">@COINOTAG</h3>
              <p className="text-muted-foreground mb-6">
                Kripto para dünyasındaki en güncel gelişmeleri, analizleri ve haberleri takip edin.
                Gerçek zamanlı piyasa verileri ve uzman yorumları.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a 
                href="https://twitter.com/coinotag" 
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Twitter'da Takip Et
              </a>
              <a 
                href="/haber" 
                className="border border-border hover:bg-muted text-foreground font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Haberleri İncele
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
} 