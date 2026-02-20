import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CreditCard, Check, Coins, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authFetch, authQueryFn } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";

interface Price {
  id: string;
  unitAmount: number;
  currency: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  metadata: { type: string; credits: string };
  prices: Price[];
}

function formatPrice(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

function getPackageHighlight(credits: number): string | null {
  if (credits === 5) return "Popular";
  if (credits === 25) return "Best Value";
  return null;
}

export default function PricingPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [processingProduct, setProcessingProduct] = useState<string | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const successSessionId = searchParams.get("success") === "true" ? searchParams.get("session_id") : null;
  const canceled = searchParams.get("canceled") === "true";

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/stripe/products"],
  });

  const { data: balance } = useQuery<{ credits: number }>({
    queryKey: ["/api/credits/balance"],
    queryFn: authQueryFn,
  });

  const verifyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await authFetch("/api/stripe/verify-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error("Verification failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
        queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({
          title: "Payment Successful!",
          description: `Your credits have been added to your account. Current balance: ${data.credits} credits.`,
        });
        window.history.replaceState({}, "", "/pricing");
      }
    },
    onError: () => {
      toast({ title: "Verification Error", description: "Could not verify payment. Please contact support.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (successSessionId) {
      verifyMutation.mutate(successSessionId);
    }
    if (canceled) {
      toast({ title: "Purchase Canceled", description: "Your purchase was canceled. No charges were made." });
      window.history.replaceState({}, "", "/pricing");
    }
  }, []);

  const checkoutMutation = useMutation({
    mutationFn: async ({ priceId, productId }: { priceId: string; productId: string }) => {
      setProcessingProduct(productId);
      const res = await authFetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, productId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Checkout failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      setProcessingProduct(null);
      toast({ title: "Checkout Error", description: error.message, variant: "destructive" });
    },
  });

  const sortedProducts = products
    ?.filter(p => p.prices.length > 0)
    .sort((a, b) => (a.prices[0]?.unitAmount ?? 0) - (b.prices[0]?.unitAmount ?? 0)) ?? [];

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto" data-testid="page-pricing">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Coins className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="text-pricing-title">Review Credits</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Purchase review credits to run AI-powered analysis on your academic papers.
          Each analysis consumes 1 credit, regardless of how many engines you select.
        </p>
        {balance !== undefined && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="font-semibold" data-testid="text-current-balance">
              Current Balance: {balance.credits} credit{balance.credits !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : sortedProducts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No packages available</h3>
            <p className="text-muted-foreground">Credit packages are being configured. Please check back soon.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {sortedProducts.map((product) => {
            const credits = product.metadata?.credits ? parseInt(product.metadata.credits) : 1;
            const price = product.prices[0];
            const pricePerCredit = price ? price.unitAmount / credits : 0;
            const highlight = getPackageHighlight(credits);
            const isPopular = highlight === "Popular";

            return (
              <Card
                key={product.id}
                className={`relative flex flex-col ${isPopular ? "border-primary shadow-md" : ""}`}
                data-testid={`card-product-${product.id}`}
              >
                {highlight && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3" variant={isPopular ? "default" : "secondary"}>
                    {highlight}
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-lg">{product.name}</CardTitle>
                  <CardDescription>{product.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 text-center space-y-3">
                  <div>
                    <span className="text-4xl font-bold" data-testid={`text-price-${product.id}`}>
                      {price ? formatPrice(price.unitAmount) : "N/A"}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatPrice(Math.round(pricePerCredit))} per review
                  </div>
                  <div className="space-y-1.5 text-sm text-left">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                      <span>{credits} paper review{credits > 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                      <span>All 6 AI engines included</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                      <span>Credits never expire</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isPopular ? "default" : "outline"}
                    disabled={!price || checkoutMutation.isPending}
                    onClick={() => price && checkoutMutation.mutate({ priceId: price.id, productId: product.id })}
                    data-testid={`button-buy-${product.id}`}
                  >
                    {processingProduct === product.id && checkoutMutation.isPending ? (
                      "Redirecting..."
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4" />
                        Buy Now
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-lg">How it works</h3>
              <p className="text-muted-foreground text-sm">
                Purchase credits, upload your paper, select your analysis engines, and get detailed AI-powered feedback.
                Each analysis run uses 1 credit regardless of which engines you choose.
              </p>
            </div>
            <Button variant="outline" asChild className="shrink-0">
              <a href="/transactions" data-testid="link-view-transactions">
                View Transaction History <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
