'use client';

import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PaymentCancelPage() {
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center bg-background text-foreground p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <XCircle className="h-10 w-10 text-red-600" />
          </div>
          <CardTitle className="text-2xl font-bold">Payment Canceled</CardTitle>
          <CardDescription className="text-muted-foreground mt-2">
            Your payment process was not completed. Your subscription has not been activated.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm">
            If you faced any issues or have questions, please contact our support team or try again.
          </p>
          <Button asChild className="w-full mt-6">
            <Link href="/pricing">View Pricing Plans</Link>
          </Button>
          <Button variant="outline" asChild className="w-full mt-2">
            <Link href="/contact">Contact Support</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
} 