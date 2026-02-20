import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { FlaskConical, ArrowLeft, CheckCircle2, AlertTriangle, Coins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { authQueryFn, authFetch } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import type { Document, Rubric } from "@shared/schema";

const ALL_ENGINES = [
  { id: "plagiarism", name: "Plagiarism Detection" },
  { id: "rubric_alignment", name: "Rubric Alignment" },
  { id: "statistics", name: "Statistics Review" },
  { id: "literature_review", name: "Literature Review" },
  { id: "anthropomorphism", name: "Anthropomorphism Check" },
  { id: "formatting", name: "Formatting Review" },
];

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreBg(score: number): string {
  if (score >= 80) return "bg-green-100 dark:bg-green-900/30";
  if (score >= 50) return "bg-yellow-100 dark:bg-yellow-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}

function formatEngineType(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export default function AnalysisPage() {
  const params = useParams<{ documentId: string }>();
  const { toast } = useToast();
  const documentId = params.documentId;

  const [selectedEngines, setSelectedEngines] = useState<string[]>(ALL_ENGINES.map((e) => e.id));
  const [selectedRubricId, setSelectedRubricId] = useState<string>("");
  const [results, setResults] = useState<any>(null);

  const { data: document, isLoading: docLoading } = useQuery<Document>({
    queryKey: ["/api/documents", documentId],
    queryFn: authQueryFn,
    enabled: !!documentId,
  });

  const { data: rubrics } = useQuery<Rubric[]>({
    queryKey: ["/api/rubrics"],
    queryFn: authQueryFn,
  });

  const { data: creditBalance } = useQuery<{ credits: number }>({
    queryKey: ["/api/credits/balance"],
    queryFn: authQueryFn,
  });

  const hasCredits = (creditBalance?.credits ?? 0) >= 1;

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const body: any = { engines: selectedEngines };
      if (selectedRubricId) body.rubricId = Number(selectedRubricId);

      const res = await authFetch(`/api/analysis/run/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Analysis failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/documents", documentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/analysis/results", documentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
      toast({ title: "Analysis Complete", description: "All engines have completed their analysis." });
    },
    onError: (error: any) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleEngine = (engineId: string) => {
    setSelectedEngines((prev) =>
      prev.includes(engineId) ? prev.filter((e) => e !== engineId) : [...prev, engineId]
    );
  };

  if (docLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-analysis">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/documents/${documentId}`} data-testid="link-back-document">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analysis-title">Run Analysis</h1>
          {document && <p className="text-muted-foreground">{document.title}</p>}
        </div>
      </div>

      {!results && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Analysis Engines</CardTitle>
                <CardDescription>Select which engines to run on your document</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ALL_ENGINES.map((engine) => (
                  <div key={engine.id} className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                    <Checkbox
                      id={engine.id}
                      checked={selectedEngines.includes(engine.id)}
                      onCheckedChange={() => toggleEngine(engine.id)}
                      data-testid={`checkbox-engine-${engine.id}`}
                    />
                    <Label htmlFor={engine.id} className="flex-1 cursor-pointer">
                      <span className="font-medium">{engine.name}</span>
                    </Label>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Rubric (Optional)</Label>
                  <Select value={selectedRubricId} onValueChange={setSelectedRubricId}>
                    <SelectTrigger data-testid="select-rubric">
                      <SelectValue placeholder="Select a rubric" />
                    </SelectTrigger>
                    <SelectContent>
                      {rubrics?.map((rubric) => (
                        <SelectItem key={rubric.id} value={String(rubric.id)}>
                          {rubric.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!hasCredits && (
                  <Alert variant="destructive" data-testid="alert-no-credits">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="flex flex-col gap-2">
                      <span>You need at least 1 review credit to run an analysis.</span>
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/pricing">
                          <Coins className="h-3 w-3" /> Buy Credits
                        </Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {hasCredits && (
                  <p className="text-xs text-muted-foreground" data-testid="text-credit-cost">
                    This will use 1 credit. Balance: {creditBalance?.credits ?? 0}
                  </p>
                )}
                <Button
                  className="w-full"
                  onClick={() => analysisMutation.mutate()}
                  disabled={analysisMutation.isPending || selectedEngines.length === 0 || !hasCredits}
                  data-testid="button-run-analysis"
                >
                  {analysisMutation.isPending ? (
                    <>Analyzing...</>
                  ) : (
                    <>
                      <FlaskConical className="h-4 w-4" />
                      Run Analysis ({selectedEngines.length} engines)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {analysisMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <FlaskConical className="h-12 w-12 mx-auto text-primary mb-4 animate-pulse" />
            <h3 className="text-lg font-medium mb-2">Analysis in Progress</h3>
            <p className="text-muted-foreground mb-4">Running {selectedEngines.length} analysis engines...</p>
            <Progress value={undefined} className="h-2 max-w-md mx-auto" />
          </CardContent>
        </Card>
      )}

      {results && (
        <>
          {results.aggregated && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <CardTitle className="text-lg">Analysis Complete</CardTitle>
                  </div>
                  <span className={`text-3xl font-bold ${getScoreColor(results.aggregated.overallScore)}`} data-testid="text-overall-score">
                    {results.aggregated.overallScore}%
                  </span>
                </div>
                <CardDescription>Overall score across all engines</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={results.aggregated.overallScore} className="h-3" />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.results?.map((result: any) => (
              <Card key={result.id} data-testid={`result-card-${result.engineType}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">{formatEngineType(result.engineType)}</CardTitle>
                    <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                      {result.status}
                    </Badge>
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
                  {result.results?.summary && (
                    <p className="text-sm text-muted-foreground">{result.results.summary}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Risk Heatmap</CardTitle>
              <CardDescription>Score distribution across engines</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {results.results?.map((result: any) => (
                  <div
                    key={result.id}
                    className={`rounded-md p-4 text-center ${getScoreBg(result.score || 0)}`}
                    data-testid={`heatmap-${result.engineType}`}
                  >
                    <p className="text-xs text-muted-foreground mb-1">{formatEngineType(result.engineType)}</p>
                    <p className={`text-xl font-bold ${getScoreColor(result.score || 0)}`}>
                      {result.score ?? 0}%
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
