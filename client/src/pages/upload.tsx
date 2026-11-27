import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Upload as UploadIcon, FileText, X, FileUp, Type } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";

const submissionTypes = [
  { value: "dissertation", label: "Dissertation" },
  { value: "proposal", label: "Proposal" },
  { value: "prospectus", label: "Prospectus" },
  { value: "quantitative_study", label: "Quantitative Study" },
  { value: "qualitative_study", label: "Qualitative Study" },
  { value: "mixed_methods", label: "Mixed Methods" },
  { value: "grant_proposal", label: "Grant Proposal" },
  { value: "irb_submission", label: "IRB Submission" },
  { value: "journal_manuscript", label: "Journal Manuscript" },
  { value: "ai_research_paper", label: "AI Research Paper" },
];

// Text is extracted on the server; these are the formats it can read.
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const uploadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  submissionType: z.string().min(1, "Submission type is required"),
  fileContent: z.string(),
});

type UploadForm = z.infer<typeof uploadSchema>;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.substring(idx).toLowerCase() : "";
}

export default function UploadPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [inputMethod, setInputMethod] = useState<string>("file");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { title: "", submissionType: "", fileContent: "" },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: UploadForm) => {
      const body = new FormData();
      body.append("title", data.title);
      body.append("submissionType", data.submissionType);
      if (inputMethod === "file" && uploadedFile) {
        body.append("file", uploadedFile, uploadedFile.name);
      } else {
        const name = `${data.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "pasted_text"}.txt`;
        body.append("file", new Blob([data.fileContent], { type: "text/plain;charset=utf-8" }), name);
      }
      // The browser sets the multipart boundary; do not set Content-Type manually.
      const res = await authFetch("/api/documents/upload", { method: "POST", body });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      const words = data?.metadata?.extraction?.words;
      toast({ title: "Document Uploaded", description: words ? `Extracted ${Number(words).toLocaleString()} words.` : "Your document has been uploaded successfully." });
      setLocation(`/documents/${data.id}`);
    },
    onError: (error: any) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const processFile = useCallback(async (file: File) => {
    const ext = getFileExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      toast({
        title: "Unsupported File Type",
        description: `Supported formats: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File Too Large",
        description: `Maximum file size is ${formatFileSize(MAX_FILE_SIZE)}.`,
        variant: "destructive",
      });
      return;
    }

    setUploadedFile(file);
    form.setValue("fileContent", "", { shouldValidate: false });
    if (!form.getValues("title")) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      form.setValue("title", nameWithoutExt, { shouldValidate: true });
    }
  }, [form, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setInputMethod("file");
      processFile(file);
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const clearFile = useCallback(() => {
    setUploadedFile(null);
    form.setValue("fileContent", "", { shouldValidate: false });
  }, [form]);

  const onSubmit = (data: UploadForm) => {
    if (inputMethod === "file" && !uploadedFile) {
      form.setError("fileContent", { message: "Select a file to upload" });
      return;
    }
    if (inputMethod === "paste" && data.fileContent.trim().length < 50) {
      form.setError("fileContent", { message: "Pasted text must be at least 50 characters" });
      return;
    }
    uploadMutation.mutate(data);
  };

  const currentContent = form.watch("fileContent");
  const charCount = currentContent?.length ?? 0;

  return (
    <div
      className="p-6 max-w-3xl mx-auto"
      data-testid="page-upload"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" data-testid="drop-overlay">
          <div className="flex flex-col items-center gap-4 p-12 rounded-xl border-2 border-dashed border-primary bg-primary/5">
            <FileUp className="h-16 w-16 text-primary animate-bounce" />
            <p className="text-xl font-semibold text-primary">Drop your file here</p>
            <p className="text-sm text-muted-foreground">
              Supported: {ACCEPTED_EXTENSIONS.join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-upload-title">Upload Document</h1>
        <p className="text-muted-foreground">Submit a new document for AI-powered analysis</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UploadIcon className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Document Details</CardTitle>
          </div>
          <CardDescription>
            Provide document info, then add content by uploading a file, pasting text, or dragging a file onto this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter document title" data-testid="input-title" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="submissionType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Submission Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-submission-type">
                            <SelectValue placeholder="Select submission type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {submissionTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value} data-testid={`option-${type.value}`}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="fileContent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document Content</FormLabel>

                      <Tabs value={inputMethod} onValueChange={(v) => setInputMethod(v)} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="file" data-testid="tab-file-upload" className="gap-1.5">
                            <FileUp className="h-4 w-4" />
                            Upload File
                          </TabsTrigger>
                          <TabsTrigger value="paste" data-testid="tab-paste-text" className="gap-1.5">
                            <Type className="h-4 w-4" />
                            Paste Text
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="file" className="mt-3">
                          {uploadedFile ? (
                            <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/50" data-testid="file-info">
                              <FileText className="h-10 w-10 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate" data-testid="text-file-name">{uploadedFile.name}</p>
                                <p className="text-sm text-muted-foreground">{formatFileSize(uploadedFile.size)}</p>
                              </div>
                              <Badge variant="secondary" className="shrink-0">{getFileExtension(uploadedFile.name).slice(1).toUpperCase()}</Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={clearFile}
                                data-testid="button-clear-file"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div
                              className="flex flex-col items-center gap-3 p-8 rounded-lg border-2 border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                              onClick={() => fileInputRef.current?.click()}
                              data-testid="dropzone"
                            >
                              <FileUp className="h-10 w-10 text-muted-foreground" />
                              <div className="text-center">
                                <p className="font-medium">Click to select a file</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  or drag and drop anywhere on the page
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Supported: {ACCEPTED_EXTENSIONS.join(", ")} &middot; Max {formatFileSize(MAX_FILE_SIZE)}
                              </p>
                            </div>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPTED_EXTENSIONS.join(",")}
                            onChange={handleFileSelect}
                            className="hidden"
                            data-testid="input-file"
                          />
                        </TabsContent>

                        <TabsContent value="paste" className="mt-3">
                          <FormControl>
                            <Textarea
                              placeholder="Paste your document content here..."
                              className="min-h-[250px] resize-y font-mono text-sm"
                              data-testid="textarea-content"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                setUploadedFile(null);
                              }}
                            />
                          </FormControl>
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-muted-foreground">
                              {charCount > 0 ? `${charCount.toLocaleString()} characters` : "No content yet"}
                            </p>
                            {charCount > 0 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={clearFile}
                                data-testid="button-clear-text"
                              >
                                <X className="h-3 w-3 mr-1" />
                                Clear
                              </Button>
                            )}
                          </div>
                        </TabsContent>
                      </Tabs>

                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={uploadMutation.isPending}
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  "Uploading..."
                ) : (
                  <>
                    <UploadIcon className="h-4 w-4" />
                    Upload Document
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
