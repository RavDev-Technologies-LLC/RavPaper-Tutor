import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Shield, ArrowLeft, ChevronLeft, ChevronRight, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { authQueryFn, authFetch } from "@/lib/auth";
import type { Document } from "@shared/schema";

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function getDifficultyColor(difficulty: string): string {
  switch (difficulty?.toLowerCase()) {
    case "hard": return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300";
    case "medium": return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300";
    default: return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300";
  }
}

export default function DefensePage() {
  const params = useParams<{ documentId: string }>();
  const { toast } = useToast();
  const documentId = params.documentId;

  const [session, setSession] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<Record<number, any>>({});

  const { data: document, isLoading: docLoading } = useQuery<Document>({
    queryKey: ["/api/documents", documentId],
    queryFn: authQueryFn,
    enabled: !!documentId,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/analysis/defense/${documentId}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Failed to start defense simulation");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setSession(data);
      setCurrentIndex(0);
      setAnswer("");
      setAnswers({});
    },
    onError: (error: any) => {
      toast({ title: "Failed to Start", description: error.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/analysis/defense/${session.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: currentIndex, answer }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Failed to submit answer");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAnswers((prev) => ({ ...prev, [currentIndex]: data }));
      setAnswer("");
    },
    onError: (error: any) => {
      toast({ title: "Submission Failed", description: error.message, variant: "destructive" });
    },
  });

  if (docLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const questions: any[] = session?.questions || [];
  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex];
  const allAnswered = questions.length > 0 && Object.keys(answers).length >= questions.length;

  const totalScore = Object.values(answers).reduce(
    (sum: number, a: any) => sum + (a?.evaluation?.score || 0),
    0
  );
  const avgScore = Object.keys(answers).length > 0
    ? Math.round(totalScore / Object.keys(answers).length)
    : 0;

  return (
    <div className="p-6 space-y-6" data-testid="page-defense">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/documents/${documentId}`} data-testid="link-back-document">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-defense-title">Defense Simulation</h1>
          {document && <p className="text-muted-foreground">{document.title}</p>}
        </div>
      </div>

      {!session && (
        <Card>
          <CardContent className="text-center py-16">
            <Shield className="h-16 w-16 mx-auto text-primary mb-4" />
            <h3 className="text-xl font-bold mb-2">Dissertation Defense Simulator</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Practice defending your research with AI-generated questions tailored to your document content.
            </p>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="button-start-defense"
            >
              {startMutation.isPending ? "Generating Questions..." : "Start Defense Simulation"}
            </Button>
          </CardContent>
        </Card>
      )}

      {session && questions.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">
              Question {currentIndex + 1} of {questions.length}
            </p>
            <Progress value={((Object.keys(answers).length) / questions.length) * 100} className="h-2 flex-1 max-w-xs" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                {currentQuestion.category && (
                  <Badge variant="outline">{currentQuestion.category}</Badge>
                )}
                {currentQuestion.difficulty && (
                  <Badge className={getDifficultyColor(currentQuestion.difficulty)}>
                    {currentQuestion.difficulty}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg mt-2" data-testid="text-question">
                {currentQuestion.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!currentAnswer ? (
                <>
                  <Textarea
                    placeholder="Type your answer here..."
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    className="min-h-[150px] resize-y"
                    data-testid="textarea-answer"
                  />
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending || !answer.trim()}
                    className="w-full"
                    data-testid="button-submit-answer"
                  >
                    {submitMutation.isPending ? "Evaluating..." : (
                      <>
                        <Send className="h-4 w-4" />
                        Submit Answer
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-md bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Your Answer:</p>
                    <p className="text-sm">{currentAnswer.evaluation ? answers[currentIndex]?.evaluation?.answer || answer : answer}</p>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium">Score:</span>
                    <span className={`text-2xl font-bold ${getScoreColor(currentAnswer.evaluation?.score || 0)}`} data-testid="text-answer-score">
                      {currentAnswer.evaluation?.score || 0}%
                    </span>
                  </div>
                  <Progress value={currentAnswer.evaluation?.score || 0} className="h-2" />

                  {currentAnswer.evaluation?.feedback && (
                    <div>
                      <p className="text-sm font-medium mb-1">Feedback:</p>
                      <p className="text-sm text-muted-foreground" data-testid="text-feedback">{currentAnswer.evaluation.feedback}</p>
                    </div>
                  )}

                  {currentAnswer.evaluation?.strengths && currentAnswer.evaluation.strengths.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1 text-green-600 dark:text-green-400">Strengths:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {currentAnswer.evaluation.strengths.map((s: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground">{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {currentAnswer.evaluation?.weaknesses && currentAnswer.evaluation.weaknesses.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1 text-red-600 dark:text-red-400">Areas for Improvement:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {currentAnswer.evaluation.weaknesses.map((w: string, i: number) => (
                          <li key={i} className="text-sm text-muted-foreground">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              data-testid="button-prev-question"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
              disabled={currentIndex >= questions.length - 1}
              data-testid="button-next-question"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {allAnswered && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <CardTitle className="text-lg">Defense Complete</CardTitle>
                </div>
                <CardDescription>You have answered all {questions.length} questions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <span className="text-sm font-medium">Overall Defense Score:</span>
                  <span className={`text-3xl font-bold ${getScoreColor(avgScore)}`} data-testid="text-overall-defense-score">
                    {avgScore}%
                  </span>
                </div>
                <Progress value={avgScore} className="h-3" />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
