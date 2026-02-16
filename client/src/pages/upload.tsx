import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Upload as UploadIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const uploadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  submissionType: z.string().min(1, "Submission type is required"),
  fileContent: z.string().min(10, "Document content must be at least 10 characters"),
});

type UploadForm = z.infer<typeof uploadSchema>;

export default function UploadPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { title: "", submissionType: "", fileContent: "" },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: UploadForm) => {
      const res = await authFetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          submissionType: data.submissionType,
          fileName: `${data.title.replace(/\s+/g, "_").toLowerCase()}.txt`,
          fileSize: new Blob([data.fileContent]).size,
          fileContent: data.fileContent,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document Uploaded", description: "Your document has been uploaded successfully." });
      setLocation(`/documents/${data.id}`);
    },
    onError: (error: any) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: UploadForm) => {
    uploadMutation.mutate(data);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto" data-testid="page-upload">
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
          <CardDescription>Provide information about your document and paste its content below</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

              <FormField
                control={form.control}
                name="fileContent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Content</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Paste your document content here..."
                        className="min-h-[300px] resize-y"
                        data-testid="textarea-content"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={uploadMutation.isPending}
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
