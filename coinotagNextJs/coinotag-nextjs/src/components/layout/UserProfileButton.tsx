'use client';

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, UserCircle, Settings, CreditCard, LayoutDashboard, Gem } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from '@/lib/supabase-client';

export default function UserProfileButton() {
  const { data: session, status } = useSession();
  const [userTier, setUserTier] = useState<string | null>(null);
  const [isLoadingTier, setIsLoadingTier] = useState<boolean>(true);

  useEffect(() => {
    async function fetchUserTier() {
      if (session?.user?.id) {
        setIsLoadingTier(true);
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('subscription_tier')
            .eq('id', session.user.id)
            .single();
          if (error && error.code !== 'PGRST116') {
            console.error("Error fetching user tier:", error);
          }
          setUserTier(data?.subscription_tier || 'FREE');
        } catch (e) {
          console.error("Exception fetching user tier:", e);
          setUserTier('FREE'); // Hata durumunda varsayılan
        }
        setIsLoadingTier(false);
      }
    }

    if (status === "authenticated") {
      fetchUserTier();
    } else if (status === "unauthenticated") {
        setUserTier(null);
        setIsLoadingTier(false);
    }
  }, [session, status]);

  if (status === "loading") {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  if (!session || !session.user) {
    return (
      <Link href="/login">
        <Button variant="outline">Login</Button>
      </Link>
    );
  }

  const userName = session.user.name || session.user.email?.split('@')[0] || "User";
  const userImage = session.user.image;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-auto px-2 flex items-center space-x-2">
          <Avatar className="h-8 w-8">
            {userImage && <AvatarImage src={userImage} alt={userName} />}
            <AvatarFallback>{userName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium truncate max-w-[100px]">{userName}</span>
            {!isLoadingTier && userTier && (
                <span className={`text-xs ${userTier !== 'FREE' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                    {userTier}
                </span>
            )}
            {isLoadingTier && <Skeleton className="h-3 w-10 mt-0.5"/>}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{session.user.name || "Account"}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {session.user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" />Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile"><UserCircle className="mr-2 h-4 w-4" />Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/pricing" className="flex items-center">
            <Gem className="mr-2 h-4 w-4 text-primary" /> 
            <span>Manage Subscription</span>
            {userTier && userTier !== 'FREE' && (
                <Badge variant="secondary" className="ml-auto bg-primary/20 text-primary hover:bg-primary/30">{userTier}</Badge>
            )}
          </Link>
        </DropdownMenuItem>
         <DropdownMenuItem asChild>
          <Link href="/billing"><CreditCard className="mr-2 h-4 w-4" />Billing</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="text-red-500 hover:!text-red-600 focus:text-red-600">
          <LogOut className="mr-2 h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 