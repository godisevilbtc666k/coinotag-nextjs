'use client'

import React from 'react'

export default function AlertsManager({ 
  symbol = 'BTC', 
  marketType = 'spot',
  currentPrice = 0 
}: {
  symbol?: string
  marketType?: 'spot' | 'futures'
  currentPrice?: number
}) {
  return (
    <div className="w-full p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">
        {symbol} Alarmları ({marketType})
      </h3>
      <div className="text-center text-gray-500 py-8">
        Alarm sistemi yakında aktif olacak...
        <br />
        <small>PRO+ üyeler için gelişmiş alarm özellikleri</small>
      </div>
    </div>
  )
} 