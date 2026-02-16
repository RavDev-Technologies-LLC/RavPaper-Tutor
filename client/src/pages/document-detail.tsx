import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { FileText, FlaskConical, Shield, Trash2, ArrowLeft, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { authQueryFn, authFetch } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import type { Document, Annotation, AnalysisResult } from "@shared/schema";

function getStatusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300";
    case "processing": return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300";
    case "failed": return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300";
    default: return "";
  }
}

function getSeverityVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "critical": return "destructive";
    case "warning": return "outline";
    default: return "secondary";
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "warning": return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300";
    default: return "";
  }
}

function formatSubmissionType(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatEngineType(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = params.id;

  const { data: document, isLoading: docLoading } = useQuery<Document>({
    queryKey: ["/api/documents", id],
    queryFn: authQueryFn,
    enabled: !!id,
  });

  const { data: annotations, isLoading: annLoading } = useQuery<Annotation[]>({
    queryKey: ["/api/documents", id, "annotations"],
    queryFn: authQueryFn,
    enabled: !!id,
  });

  const { data: analysisResults, isLoading: resultsLoading } = useQuery<AnalysisResult[]>({
    queryKey: ["/api/analysis/results", id],
    queryFn: authQueryFn,
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete document");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document Deleted", description: "The document has been removed." });
      setLocation("/documents");
    },
    onError: () => {
      toast({ title: "Delete Failed", description: "Could not delete the document.", variant: "destructive" });
    },
  });

  if (docLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold">Document Not Found</h2>
        <p className="text-muted-foreground mt-2">The requested document could not be found.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/documents">Back to Documents</Link>
        </Button>
      </div>
    );
  }

  const annotationsByEngine: Record<string, Annotation[]> = {};
  (annotations || []).forEach((ann) => {
    const key = ann.engineType || "unknown";
    if (!annotationsByEngine[key]) annotationsByEngine[key] = [];
    annotationsByEngine[key].push(ann);
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-document-detail">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 flex-wrap">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/documents" data-testid="link-back-documents">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-document-title">{document.title}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{formatSubmissionType(document.submissionType)}</Badge>
              <Badge className={getStatusColor(document.status)}>{document.status}</Badge>
              {document.overallScore != null && (
                <span className={`font-bold ${getScoreColor(document.overallScore)}`} data-testid="text-overall-score">
                  Score: {document.overallScore}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild>
            <Link href={`/analysis/${id}`} data-testid="link-run-analysis">
              <FlaskConical className="h-4 w-4" />
              Run Analysis
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/defense/${id}`} data-testid="link-defense-sim">
              <Shield className="h-4 w-4" />
              Defense Sim
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="icon"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid="button-delete-document"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="annotations" data-testid="tab-annotations">
            Annotations {annotations?.length ? `(${annotations.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="results" data-testid="tab-results">Analysis Results</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Document Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">File Name</p>
                  <p className="text-sm font-medium" data-testid="text-file-name">{document.fileName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">File Size</p>
                  <p className="text-sm font-medium">{document.fileSize ? `${(document.fileSize / 1024).toFixed(1)} KB` : "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Uploaded</p>
                  <p className="text-sm font-medium">{formatDate(document.createdAt as unknown as string)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Updated</p>
                  <p className="text-sm font-medium">{formatDate(document.updatedAt as unknown as string)}</p>
                </div>
              </div>
              {document.fileContent && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Content Preview</p>
                    <div className="rounded-md bg-muted p-4 text-sm whitespace-pre-wrap" data-testid="text-content-preview">
                      {document.fileContent.slice(0, 500)}
                      {document.fileContent.length > 500 && "..."}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="annotations" className="space-y-4 mt-4">
          {annLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !annotations || annotations.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No annotations yet. Run an analysis to generate annotations.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(annotationsByEngine).map(([engine, anns]) => (
              <Card key={engine}>
                <CardHeader>
                  <CardTitle className="text-lg">{formatEngineType(engine)}</CardTitle>
                  <CardDescription>{anns.length} annotation{anns.length !== 1 ? "s" : ""}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {anns.map((ann) => (
                    <div key={ann.id} className="flex items-start gap-3 p-3 rounded-md bg-muted/50" data-testid={`annotation-${ann.id}`}>
                      <Badge variant={getSeverityVariant(ann.severity)} className={getSeverityColor(ann.severity)}>
                        {ann.severity}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{ann.originalText}</p>
                        {ann.suggestion && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Suggestion: {ann.suggestion}
                          </p>
                        )}
                        {ann.category && (
                          <Badge variant="outline" className="mt-1">{ann.category}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="results" className="space-y-4 mt-4">
          {resultsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : !analysisResults || analysisResults.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <FlaskConical className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-3">No analysis results yet.</p>
                <Button asChild>
                  <Link href={`/analysis/${id}`} data-testid="link-run-first-analysis">Run Analysis</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analysisResults.map((result) => (
                <Card key={result.id} data-testid={`result-card-${result.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-base">{formatEngineType(result.engineType)}</CardTitle>
                      <Badge className={getStatusColor(result.status)}>{result.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.score != null && (
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm text-muted-foreground">Score</span>
                          <span className={`text-lg font-bold ${getScoreColor(result.score)}`}>
                            {result.score}%
                          </span>
                        </div>
                        <Progress value={result.score} className="h-2" />
                      </div>
                    )}
                    {result.results && typeof result.results === "object" && (result.results as any).summary && (
                      <p className="text-sm text-muted-foreground">{(result.results as any).summary}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
