'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id');

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center bg-background text-foreground p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold">Payment Successful!</CardTitle>
          <CardDescription className="text-muted-foreground mt-2">
            Your subscription has been activated. Thank you for joining us.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {orderId && (
            <p className="text-sm text-muted-foreground">
              Order ID: <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{orderId}</span>
            </p>
          )}
          <p className="text-sm">
            You can now access all the features of your new plan.
          </p>
          <Button asChild className="w-full mt-6">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
          <Button variant="outline" asChild className="w-full mt-2">
            <Link href="/pricing">Manage Subscription</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
} 