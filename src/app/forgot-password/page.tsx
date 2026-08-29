"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, MailCheck, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { AUTH_EMAIL_DOMAIN_NOTE, shouldSuggestWiscEmail } from "@/lib/auth-email-guidance";

type ForgotPasswordResponse = {
  message?: string;
  resetEmailConfigured?: boolean;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState("");
  const [isNetworkError, setIsNetworkError] = useState(false);

  const { submit, submitting, formError, clearErrors } = useFormSubmit<Record<string, string>, ForgotPasswordResponse>({
    url: "/api/auth/forgot-password",
    skipAuthRedirect: true,
    onSuccess: (data) => {
      setSubmittedMessage(data.message || "If that account exists, password reset instructions are available.");
      setSubmitted(true);
    },
    onError: (kind) => setIsNetworkError(kind === "network"),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsNetworkError(false);
    await submit({ email });
  }

  return (
    <AuthScreen subtitle="Reset your password">
          {submitted ? (
            <div className="flex flex-col gap-4 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheck className="size-6 text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-medium">Password reset request received</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {submittedMessage}
                </p>
              </div>
              <Link href="/login">
                <Button type="button" variant="outline" className="w-full h-11 text-base font-semibold">Back to sign in</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (formError) { clearErrors(); setIsNetworkError(false); } }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  autoFocus
                  disabled={submitting}
                  className="h-11 text-base transition-colors"
                />
                {shouldSuggestWiscEmail(email) && (
                  <Alert role="status" aria-live="polite" className="bg-muted/40">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{AUTH_EMAIL_DOMAIN_NOTE}</AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!formError}>
                <div className="overflow-hidden">
                  {formError && (
                    <Alert variant="destructive" className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
                      {isNetworkError ? <WifiOff className="size-4" /> : <AlertCircle className="size-4" />}
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>

              <Button type="submit" className="w-full h-11 text-base font-semibold transition-all" disabled={submitting}>
                {submitting ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Sending...
                  </>
                ) : "Request password reset"}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="font-medium text-foreground hover:underline transition-colors">Back to sign in</Link>
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Need help?{" "}
                <a
                  href="mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20help"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Contact Erik Role
                </a>
              </p>
            </form>
          )}
    </AuthScreen>
  );
}
