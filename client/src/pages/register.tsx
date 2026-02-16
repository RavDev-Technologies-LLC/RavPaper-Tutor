import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GraduationCap, BookOpen, FlaskConical, Shield, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

const registerSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  username: z.string().min(3, "Username must be at least 3 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type RegisterForm = z.infer<typeof registerSchema>;

const features = [
  { icon: BookOpen, title: "Document Analysis", description: "AI-powered review of academic papers" },
  { icon: FlaskConical, title: "Multi-Engine Analysis", description: "Six specialized analysis engines" },
  { icon: Shield, title: "Defense Simulation", description: "Practice your dissertation defense" },
  { icon: BarChart3, title: "Scoring & Insights", description: "Detailed scoring and feedback" },
];

export default function RegisterPage() {
  const { register, registerPending } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", username: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: RegisterForm) => {
    try {
      await register({
        fullName: data.fullName,
        email: data.email,
        username: data.username,
        password: data.password,
      });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Registration Failed",
        description: error.message || "Could not create account",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex min-h-screen" data-testid="page-register">
      <div className="hidden lg:flex lg:w-1/2 bg-primary flex-col justify-center p-12">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary-foreground/20">
              <GraduationCap className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-primary-foreground">Paper Tutor</h1>
              <p className="text-sm text-primary-foreground/80">AI-Powered Academic Intelligence</p>
            </div>
          </div>
          <p className="text-lg text-primary-foreground/90 mb-8">
            Join thousands of researchers using AI to improve their academic writing.
          </p>
          <div className="space-y-4">
            {features.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary-foreground/10 shrink-0 mt-0.5">
                  <feature.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-primary-foreground">{feature.title}</h3>
                  <p className="text-sm text-primary-foreground/70">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 lg:hidden mb-4">
              <GraduationCap className="h-6 w-6 text-primary" />
              <span className="text-lg font-semibold">Paper Tutor</span>
            </div>
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>Get started with Paper Tutor</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Dr. Jane Smith" data-testid="input-fullname" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="you@university.edu" data-testid="input-email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="jsmith" data-testid="input-username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="At least 6 characters" data-testid="input-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Confirm your password" data-testid="input-confirm-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={registerPending}
                  data-testid="button-register"
                >
                  {registerPending ? "Creating account..." : "Create Account"}
                </Button>
              </form>
            </Form>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium" data-testid="link-login">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
