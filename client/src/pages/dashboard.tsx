import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, FlaskConical, BarChart3, Shield, Upload, ArrowRight, Coins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authQueryFn } from "@/lib/auth";
import type { Document } from "@shared/schema";

interface CreditBalance {
  credits: number;
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "processing": return "outline";
    case "failed": return "destructive";
    default: return "secondary";
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300";
    case "processing": return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300";
    case "failed": return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300";
    default: return "";
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSubmissionType(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export default function DashboardPage() {
  const { data: documents, isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
    queryFn: authQueryFn,
  });

  const { data: creditBalance } = useQuery<CreditBalance>({
    queryKey: ["/api/credits/balance"],
    queryFn: authQueryFn,
  });

  const totalDocs = documents?.length ?? 0;
  const completedAnalyses = documents?.filter((d) => d.status === "completed").length ?? 0;
  const avgScore = documents?.filter((d) => d.overallScore != null).length
    ? Math.round(
        documents!.filter((d) => d.overallScore != null).reduce((sum, d) => sum + (d.overallScore ?? 0), 0) /
          documents!.filter((d) => d.overallScore != null).length
      )
    : 0;
  const recentDocs = documents?.slice(0, 5) ?? [];

  const stats = [
    { title: "Documents", value: totalDocs, icon: FileText, description: "Total uploaded" },
    { title: "Analyses Completed", value: completedAnalyses, icon: FlaskConical, description: "Successfully analyzed" },
    { title: "Average Score", value: avgScore, icon: BarChart3, description: "Across all documents" },
    { title: "Review Credits", value: creditBalance?.credits ?? 0, icon: Coins, description: "Available for analysis" },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="page-dashboard">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your academic documents and analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {docsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid={`text-stat-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}>
                  {stat.value}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">Recent Documents</CardTitle>
              <CardDescription>Your latest uploaded documents</CardDescription>
            </div>
            <Button variant="outline" asChild>
              <Link href="/documents" data-testid="link-view-all-documents">
                View All <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {docsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentDocs.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No documents yet</p>
              <Button variant="outline" className="mt-3" asChild>
                <Link href="/upload" data-testid="link-upload-first">Upload your first document</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDocs.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer"
                    data-testid={`row-document-${doc.id}`}
                  >
                    <TableCell>
                      <Link href={`/documents/${doc.id}`} className="font-medium">
                        {doc.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatSubmissionType(doc.submissionType)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(doc.status)} className={getStatusColor(doc.status)}>
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-score-${doc.id}`}>
                      {doc.overallScore != null ? `${doc.overallScore}%` : "--"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(doc.createdAt as unknown as string)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover-elevate">
          <CardHeader>
            <Upload className="h-8 w-8 text-primary mb-2" />
            <CardTitle className="text-lg">Upload Document</CardTitle>
            <CardDescription>Submit a new document for analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/upload" data-testid="link-quick-upload">Get Started</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader>
            <FlaskConical className="h-8 w-8 text-primary mb-2" />
            <CardTitle className="text-lg">Run Analysis</CardTitle>
            <CardDescription>Analyze documents with AI engines</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild className="w-full">
              <Link href="/documents" data-testid="link-quick-analysis">Select Document</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader>
            <Shield className="h-8 w-8 text-primary mb-2" />
            <CardTitle className="text-lg">Defense Simulation</CardTitle>
            <CardDescription>Practice your dissertation defense</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild className="w-full">
              <Link href="/documents" data-testid="link-quick-defense">Select Document</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
