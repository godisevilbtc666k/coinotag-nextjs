import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(req: NextRequest) {
  try {
    const { chatId } = await req.json()

    if (!chatId) {
      return NextResponse.json({ error: 'Chat ID required' }, { status: 400 })
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get(name: string) {
            return req.cookies.get(name)?.value
          },
          set() {},
          remove() {},
        },
      }
    )

    // Check if user exists with this chat ID
    const { data: telegramUser, error } = await supabase
      .from('telegram_users')
      .select(`
        user_id,
        created_at,
        profiles:user_id (
          username,
          full_name,
          subscription_tier
        )
      `)
      .eq('telegram_chat_id', chatId)
      .single()

    if (error || !telegramUser) {
      return NextResponse.json({ 
        verified: false,
        message: 'User not found or not verified'
      })
    }

    return NextResponse.json({ 
      verified: true,
      userId: telegramUser.user_id,
      profile: telegramUser.profiles,
      lastActivity: telegramUser.created_at,
      tier: (telegramUser.profiles as any)?.subscription_tier || 'FREE'
    })

  } catch (error) {
    console.error('Status check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 