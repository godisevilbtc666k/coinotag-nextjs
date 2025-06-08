import React from 'react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vadeli İşlem Piyasası - COINOTAG',
  description: 'Bitcoin, Ethereum ve altcoin vadeli işlem fiyatları. Gerçek zamanlı futures piyasa verileri.',
};

export default function FuturesPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Vadeli İşlem Piyasası</h1>
        <p className="text-muted-foreground">
          Kripto para vadeli işlem piyasasındaki en güncel fiyatlar ve veriler
        </p>
      </div>

      <div className="bg-card rounded-lg p-6 border">
        <h2 className="text-xl font-semibold mb-4">Futures Piyasa Verileri</h2>
        <p className="text-muted-foreground">
          Vadeli işlem verileri yükleniyor...
        </p>
      </div>
    </div>
  );
} 