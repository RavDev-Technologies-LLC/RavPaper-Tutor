import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Upload, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authQueryFn } from "@/lib/auth";
import type { Document } from "@shared/schema";

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

export default function DocumentsPage() {
  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
    queryFn: authQueryFn,
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-documents">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-documents-title">Documents</h1>
          <p className="text-muted-foreground">Manage your academic documents</p>
        </div>
        <Button asChild>
          <Link href="/upload" data-testid="link-upload-document">
            <Plus className="h-4 w-4" />
            Upload Document
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !documents || documents.length === 0 ? (
            <div className="text-center py-16">
              <Upload className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No documents yet</h3>
              <p className="text-muted-foreground mb-4">
                Upload your first document to get started with AI-powered analysis
              </p>
              <Button asChild>
                <Link href="/upload" data-testid="link-upload-first-document">Upload Document</Link>
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
                {documents.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer"
                    data-testid={`row-document-${doc.id}`}
                  >
                    <TableCell>
                      <Link href={`/documents/${doc.id}`} className="flex items-center gap-2 font-medium">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
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
                    <TableCell data-testid={`text-doc-score-${doc.id}`}>
                      {doc.overallScore != null ? (
                        <span className={doc.overallScore >= 80 ? "text-green-600 dark:text-green-400 font-medium" : doc.overallScore >= 50 ? "text-yellow-600 dark:text-yellow-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                          {doc.overallScore}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
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
    </div>
  );
}
