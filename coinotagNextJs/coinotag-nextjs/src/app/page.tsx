import React from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "COINOTAG - Kripto Para Haberleri ve Fiyat Takibi",
  description: "En güncel kripto para haberleri, Bitcoin, Ethereum ve tüm altcoin fiyatları. Gerçek zamanlı piyasa verileri ve teknik analiz.",
  keywords: "bitcoin, ethereum, kripto para, blockchain, altcoin, defi, nft",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 py-20">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative container mx-auto px-4 text-center text-white">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            Kripto Para Dünyasının
            <span className="block bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
              Nabzını Tutun
            </span>
          </h1>
          <p className="text-xl md:text-2xl mb-8 max-w-4xl mx-auto">
            En güncel kripto para haberleri, gerçek zamanlı fiyat takibi ve detaylı piyasa analizi
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a 
              href="/kripto-paralar" 
              className="bg-white text-blue-600 font-semibold py-3 px-8 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Piyasalara Göz At
            </a>
            <a 
              href="/haber" 
              className="border-2 border-white text-white font-semibold py-3 px-8 rounded-lg hover:bg-white hover:text-blue-600 transition-colors"
            >
              Haberleri İncele
            </a>
          </div>
        </div>
      </section>

      {/* Quick Access */}
      <section className="py-16 bg-muted/50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Hızlı Erişim</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <a 
              href="/sondakikahaberleri"
              className="bg-card p-8 rounded-xl shadow-sm hover:shadow-lg transition-all border hover:border-red-200"
            >
              <div className="text-red-500 text-4xl mb-4">📰</div>
              <h3 className="text-xl font-semibold mb-2">Son Dakika</h3>
              <p className="text-muted-foreground">En güncel kripto para haberleri ve gelişmeler</p>
            </a>
            <a 
              href="/profil"
              className="bg-card p-8 rounded-xl shadow-sm hover:shadow-lg transition-all border hover:border-blue-200"
            >
              <div className="text-blue-500 text-4xl mb-4">🔔</div>
              <h3 className="text-xl font-semibold mb-2">Alarm Kur</h3>
              <p className="text-muted-foreground">Fiyat alarmları oluştur ve bildirim al</p>
            </a>
            <a 
              href="/analiz"
              className="bg-card p-8 rounded-xl shadow-sm hover:shadow-lg transition-all border hover:border-green-200"
            >
              <div className="text-green-500 text-4xl mb-4">📊</div>
              <h3 className="text-xl font-semibold mb-2">Analiz</h3>
              <p className="text-muted-foreground">Detaylı teknik analiz ve piyasa yorumları</p>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
} 