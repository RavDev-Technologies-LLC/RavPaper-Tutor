import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Coins, ArrowUpRight, ArrowDownRight, Plus, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authQueryFn } from "@/lib/auth";
import type { CreditTransaction } from "@shared/schema";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTypeBadge(type: string) {
  switch (type) {
    case "purchase":
      return <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Purchase</Badge>;
    case "usage":
      return <Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">Usage</Badge>;
    case "refund":
      return <Badge className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">Refund</Badge>;
    case "bonus":
      return <Badge className="bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300">Bonus</Badge>;
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

export default function TransactionsPage() {
  const { data: transactions, isLoading } = useQuery<CreditTransaction[]>({
    queryKey: ["/api/credits/transactions"],
    queryFn: authQueryFn,
  });

  const { data: balance } = useQuery<{ credits: number }>({
    queryKey: ["/api/credits/balance"],
    queryFn: authQueryFn,
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto" data-testid="page-transactions">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/pricing" data-testid="link-back-pricing">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-transactions-title">Transaction History</h1>
          <p className="text-muted-foreground">Your credit purchases and usage</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-balance">
              {balance?.credits ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">review credits available</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Need More Credits?</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Button asChild className="mt-2">
              <Link href="/pricing" data-testid="link-buy-credits">
                <Plus className="h-4 w-4" /> Buy Credits
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transactions</CardTitle>
          <CardDescription>All credit purchases, usage, and adjustments</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <div className="text-center py-8">
              <Coins className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No transactions yet</p>
              <Button variant="outline" className="mt-3" asChild>
                <Link href="/pricing" data-testid="link-first-purchase">Purchase your first credits</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(tx.createdAt as unknown as string)}
                    </TableCell>
                    <TableCell>{getTypeBadge(tx.type)}</TableCell>
                    <TableCell className="text-sm">{tx.description || "--"}</TableCell>
                    <TableCell className="text-right font-medium">
                      <span className={tx.amount > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {tx.amount > 0 ? (
                          <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />{tx.amount}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><Minus className="h-3 w-3" />{Math.abs(tx.amount)}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {tx.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
