"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, EyeIcon, EyeOffIcon, WifiOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { AccountUsernameField, passwordRulesAttribute } from "@/components/auth/AccountUsernameField";

type PasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

function validatePassword(password: string): string {
  if (!password) return "Password is required";
  if (password.length < 8) return "Must be at least 8 characters";
  return "";
}

export default function ForcePasswordChangeForm({ email }: { email: string }) {
  const router = useRouter();
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { submit, submitting, formError, clearErrors } = useFormSubmit<PasswordPayload>({
    url: "/api/profile",
    method: "PATCH",
    returnTo: "/change-password",
    transformBody: (data) => ({
      action: "change_password",
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    }),
    onSuccess: () => router.replace("/login"),
    onError: (kind) => setIsNetworkError(kind === "network"),
  });

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    }
    if (formError) {
      clearErrors();
      setIsNetworkError(false);
    }
  }

  function handleBlur(field: string) {
    if (field === "currentPassword") {
      setFieldErrors((prev) => ({
        ...prev,
        currentPassword: currentPassword ? "" : "Current password is required",
      }));
      return;
    }
    if (field === "newPassword") {
      setFieldErrors((prev) => ({
        ...prev,
        newPassword: validatePassword(newPassword),
      }));
      return;
    }
    const msg = confirmPassword && confirmPassword !== newPassword ? "Passwords do not match" : "";
    setFieldErrors((prev) => ({ ...prev, confirmPassword: msg }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const currentErr = currentPassword ? "" : "Current password is required";
    const passwordErr = validatePassword(newPassword);
    const confirmErr = newPassword !== confirmPassword ? "Passwords do not match" : "";
    if (currentErr || passwordErr || confirmErr) {
      setFieldErrors({
        currentPassword: currentErr,
        newPassword: passwordErr,
        confirmPassword: confirmErr,
      });
      if (currentErr) currentRef.current?.focus();
      else if (passwordErr) passwordRef.current?.focus();
      else if (confirmErr) confirmRef.current?.focus();
      return;
    }

    setIsNetworkError(false);
    await submit({ currentPassword, newPassword });
  }

  return (
    <AuthScreen subtitle="Set a new password">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <AccountUsernameField email={email} id="change-password-username" />
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>
                Temporary password sign-in for {email}. Set a new password to continue.
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentPassword">Temporary password</Label>
              <Input
                ref={currentRef}
                id="currentPassword"
                name="currentPassword"
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); clearFieldError("currentPassword"); }}
                onBlur={() => handleBlur("currentPassword")}
                autoComplete="current-password"
                required
                autoFocus
                disabled={submitting}
                aria-invalid={!!fieldErrors.currentPassword}
                aria-describedby={fieldErrors.currentPassword ? "current-password-error" : undefined}
                className="h-11 text-base transition-colors"
              />
              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.currentPassword} aria-hidden={!fieldErrors.currentPassword}>
                <p id="current-password-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.currentPassword || "\u00A0"}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <div className="relative">
                <Input
                  ref={passwordRef}
                  id="newPassword"
                  name="newPassword"
                  type={showPasswords ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); clearFieldError("newPassword"); }}
                  onBlur={() => handleBlur("newPassword")}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  {...passwordRulesAttribute}
                  required
                  minLength={8}
                  disabled={submitting}
                  aria-invalid={!!fieldErrors.newPassword}
                  aria-describedby={fieldErrors.newPassword ? "new-password-error" : undefined}
                  className="h-11 text-base pr-11 transition-colors"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 size-11 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPasswords(!showPasswords)}
                  disabled={submitting}
                  aria-pressed={showPasswords}
                  aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                >
                  {showPasswords ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
                </Button>
              </div>
              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.newPassword} aria-hidden={!fieldErrors.newPassword}>
                <p id="new-password-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.newPassword || "\u00A0"}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                ref={confirmRef}
                id="confirmPassword"
                name="confirmPassword"
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError("confirmPassword"); }}
                onBlur={() => handleBlur("confirmPassword")}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                {...passwordRulesAttribute}
                required
                minLength={8}
                disabled={submitting}
                aria-invalid={!!fieldErrors.confirmPassword}
                aria-describedby={fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
                className="h-11 text-base transition-colors"
              />
              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.confirmPassword} aria-hidden={!fieldErrors.confirmPassword}>
                <p id="confirm-password-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.confirmPassword || "\u00A0"}</p>
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
                  Updating...
                </>
              ) : "Update password"}
            </Button>
          </form>
    </AuthScreen>
  );
}
