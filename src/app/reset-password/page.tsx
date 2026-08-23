"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2, EyeIcon, EyeOffIcon, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormSubmit } from "@/hooks/use-form-submit";

function validatePassword(password: string): string {
  if (!password) return "Password is required";
  if (password.length < 8) return "Must be at least 8 characters";
  return "";
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { submit, submitting, formError, clearErrors } = useFormSubmit({
    url: "/api/auth/reset-password",
    skipAuthRedirect: true,
    transformBody: (data: { password: string }) => ({ token, password: data.password }),
    onSuccess: () => setSuccess(true),
    onError: (kind) => setIsNetworkError(kind === "network"),
  });

  function handleBlur(field: string) {
    if (field === "password") {
      setFieldErrors((prev) => ({ ...prev, password: validatePassword(password) }));
    } else if (field === "confirmPassword") {
      const msg = confirmPassword && confirmPassword !== password ? "Passwords do not match" : "";
      setFieldErrors((prev) => ({ ...prev, confirmPassword: msg }));
    }
  }

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    }
    if (formError) {
      clearErrors();
      setIsNetworkError(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const passErr = validatePassword(password);
    const confirmErr = password !== confirmPassword ? "Passwords do not match" : "";
    if (passErr || confirmErr) {
      setFieldErrors({ password: passErr, confirmPassword: confirmErr });
      if (passErr) passwordRef.current?.focus();
      else if (confirmErr) confirmRef.current?.focus();
      return;
    }

    setIsNetworkError(false);
    await submit({ password });
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4 text-center animate-in fade-in-0 duration-200">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="size-6 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">Invalid reset link</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This password reset link is invalid or has expired.
          </p>
        </div>
        <Link href="/forgot-password">
          <Button type="button" className="w-full h-11 text-base font-semibold">Request a new link</Button>
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col gap-4 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="size-6 text-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-medium">Password updated</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your password has been reset. You can now sign in with your new password.
          </p>
        </div>
        <Link href="/login">
          <Button type="button" className="w-full h-11 text-base font-semibold">Sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }}
            onBlur={() => handleBlur("password")}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
            disabled={submitting}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            className="h-11 text-base pr-11 transition-colors"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 size-11 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowPassword(!showPassword)}
            disabled={submitting}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
          </Button>
        </div>
        <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.password} aria-hidden={!fieldErrors.password}>
          <p id="password-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.password || " "}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          ref={confirmRef}
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError("confirmPassword"); }}
          onBlur={() => handleBlur("confirmPassword")}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={submitting}
          aria-invalid={!!fieldErrors.confirmPassword}
          aria-describedby={fieldErrors.confirmPassword ? "confirm-error" : undefined}
          className="h-11 text-base transition-colors"
        />
        <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.confirmPassword} aria-hidden={!fieldErrors.confirmPassword}>
          <p id="confirm-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.confirmPassword || " "}</p>
        </div>
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
            Resetting...
          </>
        ) : "Reset password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthScreen subtitle="Set a new password">
          <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-5 w-24" /><Skeleton className="h-11 w-full" /><Skeleton className="h-5 w-32" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>}>
            <ResetPasswordForm />
          </Suspense>
    </AuthScreen>
  );
}
