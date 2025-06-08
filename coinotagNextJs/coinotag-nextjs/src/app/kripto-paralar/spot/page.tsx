import React from 'react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Spot Piyasa - COINOTAG',
  description: 'Bitcoin, Ethereum ve altcoin spot fiyatları. Gerçek zamanlı spot piyasa verileri.',
};

export default function SpotPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Spot Piyasa</h1>
        <p className="text-muted-foreground">
          Kripto para spot piyasasındaki en güncel fiyatlar ve veriler
        </p>
      </div>

      <div className="bg-card rounded-lg p-6 border">
        <h2 className="text-xl font-semibold mb-4">Spot Piyasa Verileri</h2>
        <p className="text-muted-foreground">
          Spot verileri yükleniyor...
        </p>
      </div>
    </div>
  );
} 