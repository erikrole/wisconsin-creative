"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { AlertCircle, EyeIcon, EyeOffIcon, KeyRound, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { classifyError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { AUTH_EMAIL_DOMAIN_NOTE, shouldSuggestWiscEmail } from "@/lib/auth-email-guidance";
import { isPasskeyCancellation, passkeyErrorMessage } from "@/lib/passkey-client";
import { AccountUsernameField, passwordRulesAttribute } from "@/components/auth/AccountUsernameField";

type LoginResponse = {
  user?: {
    forcePasswordChange?: boolean;
  };
};

type PasskeyLoginResponse = LoginResponse & {
  options?: PublicKeyCredentialRequestOptionsJSON;
};

type DiscoveryResponse = {
  flow?: "onboarding" | "password";
};

type AuthStep = "identity" | "password" | "onboarding";

function validateName(name: string): string {
  if (!name.trim()) return "Name is required";
  return "";
}

function validateEmail(email: string): string {
  if (!email) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email format";
  return "";
}

function validatePassword(password: string): string {
  if (!password) return "Password is required";
  if (password.length < 8) return "Must be at least 8 characters";
  return "";
}

function validateConfirmation(password: string, confirmation: string): string {
  if (!confirmation) return "Confirm your password";
  if (password !== confirmation) return "Passwords do not match";
  return "";
}

export default function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [step, setStep] = useState<AuthStep>("identity");
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [autofillEpoch, setAutofillEpoch] = useState(0);
  // Only the newest ceremony may touch state or navigate. Conditional UI runs
  // for as long as the email step is on screen, so a stale resolution or the
  // abort that replaces it must not surface as a failure.
  const ceremonyRef = useRef(0);
  // Set once a ceremony has navigated away, so nothing re-arms behind the route
  // change while this component is still mounted.
  const passkeyNavigatedRef = useRef(false);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const invitedEmail = new URLSearchParams(window.location.search).get("email")?.trim() ?? "";
    if (invitedEmail) setEmail(invitedEmail);
  }, []);

  useEffect(() => {
    if (step === "identity") emailRef.current?.focus();
    if (step === "onboarding") nameRef.current?.focus();
    if (step === "password") passwordRef.current?.focus();
  }, [step]);

  const {
    submit: submitLogin,
    submitting: loginSubmitting,
    formError: loginFormError,
    clearErrors: clearLoginErrors,
  } = useFormSubmit({
    url: "/api/auth/login",
    skipAuthRedirect: true,
    onSuccess: (data: LoginResponse) => {
      router.replace(data.user?.forcePasswordChange ? "/change-password" : "/");
    },
    onError: (kind) => setIsNetworkError(kind === "network"),
  });

  const {
    submit: submitRegistration,
    submitting: registrationSubmitting,
    formError: registrationFormError,
    clearErrors: clearRegistrationErrors,
  } = useFormSubmit({
    url: "/api/auth/register",
    skipAuthRedirect: true,
    onSuccess: () => router.replace("/welcome"),
    onError: (kind) => setIsNetworkError(kind === "network"),
  });

  const submitting = identityLoading || loginSubmitting || registrationSubmitting;
  const authBusy = submitting || passkeyLoading;
  const isIdentity = step === "identity";
  const isPassword = step === "password";
  const isOnboarding = step === "onboarding";
  const formError = isIdentity
    ? identityError
    : isOnboarding
      ? registrationFormError
      : loginFormError;

  function handleBlur(field: string) {
    const validators: Record<string, () => string> = {
      name: () => validateName(name),
      email: () => validateEmail(email),
      password: () => validatePassword(password),
      confirmPassword: () => validateConfirmation(password, confirmPassword),
    };
    const msg = validators[field]?.() ?? "";
    setFieldErrors((prev) => ({ ...prev, [field]: msg }));
  }

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    }
    if (identityError) setIdentityError("");
    if (loginFormError) clearLoginErrors();
    if (registrationFormError) clearRegistrationErrors();
    setIsNetworkError(false);
  }

  function changeEmail() {
    if (authBusy) return;
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setName("");
    setIdentityError("");
    setFieldErrors({});
    clearLoginErrors();
    clearRegistrationErrors();
    setStep("identity");
  }

  async function handleIdentitySubmit() {
    const normalizedEmail = email.trim().toLowerCase();
    const emailErr = validateEmail(normalizedEmail);
    if (emailErr) {
      setFieldErrors({ email: emailErr });
      emailRef.current?.focus();
      return;
    }

    setIdentityLoading(true);
    setIdentityError("");
    setIsNetworkError(false);
    try {
      const response = await fetch("/api/auth/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "Could not check this email. Please try again."));
      }

      const result = await parseJsonSafely<DiscoveryResponse>(response);
      setEmail(normalizedEmail);
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setFieldErrors({});
      setStep(result?.flow === "onboarding" ? "onboarding" : "password");
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Could not check this email. Please try again.");
      setIsNetworkError(classifyError(error) === "network");
    } finally {
      setIdentityLoading(false);
    }
  }

  async function handlePasswordSubmit() {
    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    if (emailErr || passErr) {
      setFieldErrors({ email: emailErr, password: passErr });
      if (emailErr) emailRef.current?.focus();
      else if (passErr) passwordRef.current?.focus();
      return;
    }

    setIsNetworkError(false);
    await submitLogin({ email: email.trim().toLowerCase(), password, rememberMe });
  }

  async function handleOnboardingSubmit() {
    const nameErr = validateName(name);
    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    const confirmationErr = validateConfirmation(password, confirmPassword);
    if (nameErr || emailErr || passErr || confirmationErr) {
      setFieldErrors({ name: nameErr, email: emailErr, password: passErr, confirmPassword: confirmationErr });
      if (nameErr) nameRef.current?.focus();
      else if (emailErr) emailRef.current?.focus();
      else if (passErr) passwordRef.current?.focus();
      return;
    }

    setIsNetworkError(false);
    await submitRegistration({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isIdentity) return handleIdentitySubmit();
    if (isOnboarding) return handleOnboardingSubmit();
    return handlePasswordSubmit();
  }

  /**
   * One sign-in ceremony, run either from the button or from browser autofill.
   * The autofill run is silent until the person actually picks a passkey: it is
   * armed on every visit to the email step, so an aborted or unsupported run is
   * routine and must never look like a failed sign-in.
   */
  async function runPasskeySignIn(mode: "button" | "autofill", generation: number): Promise<boolean> {
    const isCurrent = () => ceremonyRef.current === generation;
    let assertionReceived = false;

    if (mode === "button") {
      setPasskeyError(null);
      setPasskeyLoading(true);
    }

    try {
      const optionsResponse = await fetch("/api/auth/passkey/login/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rememberMe }),
      });
      if (!optionsResponse.ok) {
        throw new Error(await parseErrorMessage(optionsResponse, "Could not start passkey sign-in."));
      }
      const optionsBody = await parseJsonSafely<PasskeyLoginResponse>(optionsResponse);
      if (!optionsBody?.options) throw new Error("Could not start passkey sign-in.");
      if (!isCurrent()) return assertionReceived;

      const assertion = await startAuthentication({
        optionsJSON: optionsBody.options,
        useBrowserAutofill: mode === "autofill",
      });
      assertionReceived = true;
      if (!isCurrent()) return assertionReceived;
      // A passkey was chosen from the autofill menu, so the form now belongs to
      // the ceremony and should show it is finishing.
      setPasskeyLoading(true);

      const verifyResponse = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!verifyResponse.ok) {
        throw new Error(await parseErrorMessage(verifyResponse, "Passkey sign-in failed. Use your password instead."));
      }
      const result = await parseJsonSafely<LoginResponse>(verifyResponse);
      if (!isCurrent()) return assertionReceived;
      passkeyNavigatedRef.current = true;
      router.replace(result?.user?.forcePasswordChange ? "/change-password" : "/");
    } catch (error) {
      if (!isCurrent()) return assertionReceived;
      if (isPasskeyCancellation(error)) return assertionReceived;
      if (mode === "autofill" && !assertionReceived) return assertionReceived;
      setPasskeyError(passkeyErrorMessage(error, "login"));
    } finally {
      if (isCurrent()) setPasskeyLoading(false);
    }

    return assertionReceived;
  }

  function handlePasskeySignIn() {
    if (authBusy) return;
    const generation = ++ceremonyRef.current;
    void runPasskeySignIn("button", generation).then(() => {
      // The button ceremony replaced the armed autofill request; put it back
      // unless it signed in and left.
      if (ceremonyRef.current === generation && !passkeyNavigatedRef.current) {
        setAutofillEpoch((epoch) => epoch + 1);
      }
    });
  }

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  // Arm browser autofill while the email step is on screen so a saved passkey
  // is offered from the email field itself. Re-arms after a button ceremony
  // ends without navigating, and when "remember me" changes, because the
  // ceremony binds the session length server-side.
  useEffect(() => {
    if (!isIdentity || !passkeySupported || passkeyNavigatedRef.current) return;

    const generation = ++ceremonyRef.current;
    let disposed = false;

    void (async () => {
      if (!(await browserSupportsWebAuthnAutofill())) return;
      if (disposed || ceremonyRef.current !== generation) return;
      const used = await runPasskeySignIn("autofill", generation);
      if (disposed || ceremonyRef.current !== generation) return;
      // Re-arm only after a passkey was actually chosen and failed, so a second
      // attempt is still offered. Re-arming on an immediate failure — no
      // autofill support, no eligible input — would loop.
      if (used && !passkeyNavigatedRef.current) setAutofillEpoch((epoch) => epoch + 1);
    })();

    return () => {
      disposed = true;
      ceremonyRef.current += 1;
      WebAuthnAbortService.cancelCeremony();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIdentity, passkeySupported, rememberMe, autofillEpoch]);

  const primaryButtonLabel = isIdentity
    ? identityLoading
      ? "Checking…"
      : "Continue"
    : isOnboarding
      ? registrationSubmitting
        ? "Creating account…"
        : "Create account"
      : loginSubmitting
        ? "Signing in…"
        : "Sign in";

  return (
    <AuthScreen
      subtitle={isOnboarding ? "Set up your account" : "Sign in to your account"}
      footer={
        <p className="login-rise text-center text-sm text-white/55 mt-6" style={{ "--rise-index": 6 } as React.CSSProperties}>
          Access is by invitation only.{" "}
          <a href="mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20gear-tracker%20access" className="text-white/80 underline underline-offset-2 hover:text-white transition-colors">Contact Erik Role</a>{" "}to request access.
        </p>
      }
    >
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isIdentity && (
                <div className="login-rise flex flex-col gap-1.5" style={{ "--rise-index": 2 } as React.CSSProperties}>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    ref={emailRef}
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
                    onBlur={() => handleBlur("email")}
                    placeholder="you@example.com"
                    // The trailing "webauthn" token is what lets the browser
                    // offer a saved passkey in this field's autofill menu.
                    autoComplete="email webauthn"
                    required
                    autoFocus
                    disabled={authBusy}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? "email-error" : undefined}
                    className="login-field h-11 text-base transition-colors"
                  />
                  <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 data-[visible=true]:grid-rows-[1fr]" data-visible={!!fieldErrors.email} aria-hidden={!fieldErrors.email}>
                    <p id="email-error" role="alert" className="overflow-hidden text-destructive text-xs">{fieldErrors.email || "\u00A0"}</p>
                  </div>
                </div>
              )}

              {isIdentity && shouldSuggestWiscEmail(email) && (
                <Alert role="status" aria-live="polite" className="bg-muted/40">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{AUTH_EMAIL_DOMAIN_NOTE}</AlertDescription>
                </Alert>
              )}

              {!isIdentity && (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <AccountUsernameField email={email} id="login-username" />
                  <span className="min-w-0 truncate">{email}</span>
                  <Button className="h-10" type="button" variant="ghost" onClick={changeEmail} disabled={authBusy}>Change</Button>
                </div>
              )}

              {isOnboarding && (
                <>
                  <Alert role="status" aria-live="polite" className="bg-muted/40">
                    <AlertCircle className="size-4" />
                    <AlertDescription>Your email is approved. Set your password now, then we’ll walk you through the details needed for work.</AlertDescription>
                  </Alert>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      ref={nameRef}
                      id="name"
                      name="name"
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); clearFieldError("name"); }}
                      onBlur={() => handleBlur("name")}
                      placeholder="Your full name"
                      autoComplete="name"
                      required
                      disabled={authBusy}
                      aria-invalid={!!fieldErrors.name}
                      aria-describedby={fieldErrors.name ? "name-error" : undefined}
                      className="login-field h-11 text-base transition-colors"
                    />
                    <p id="name-error" role="alert" className="text-destructive text-xs min-h-4">{fieldErrors.name || " "}</p>
                  </div>
                </>
              )}

              {!isIdentity && (
                <div className="login-rise flex flex-col gap-1.5" style={{ "--rise-index": 3 } as React.CSSProperties}>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{isOnboarding ? "Create password" : "Password"}</Label>
                    {isPassword && <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Forgot password?</Link>}
                  </div>
                  <div className="relative">
                    <Input
                      ref={passwordRef}
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }}
                      onBlur={() => handleBlur("password")}
                      placeholder={isOnboarding ? "At least 8 characters" : "Enter your password"}
                      autoComplete={isOnboarding ? "new-password" : "current-password"}
                      {...(isOnboarding ? passwordRulesAttribute : {})}
                      required
                      minLength={8}
                      disabled={authBusy}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? "password-error" : undefined}
                      className="login-field h-11 text-base pr-11 transition-colors"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 size-11 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={authBusy}
                      aria-pressed={showPassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <span key={showPassword ? "hide" : "show"} className="flex items-center justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-safe:duration-200">
                        {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
                      </span>
                    </Button>
                  </div>
                  <p id="password-error" role="alert" className="text-destructive text-xs min-h-4">{fieldErrors.password || " "}</p>
                </div>
              )}

              {isOnboarding && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError("confirmPassword"); }}
                    onBlur={() => handleBlur("confirmPassword")}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    {...passwordRulesAttribute}
                    required
                    minLength={8}
                    disabled={authBusy}
                    aria-invalid={!!fieldErrors.confirmPassword}
                    aria-describedby={fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
                    className="login-field h-11 text-base transition-colors"
                  />
                  <p id="confirm-password-error" role="alert" className="text-destructive text-xs min-h-4">{fieldErrors.confirmPassword || " "}</p>
                </div>
              )}

              {!isOnboarding && (
                <div className="login-rise flex items-center gap-2" style={{ "--rise-index": 4 } as React.CSSProperties}>
                  <Checkbox
                    id="rememberMe"
                    name="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                    className="login-checkbox shrink-0"
                  />
                  <Label htmlFor="rememberMe" className="text-sm text-muted-foreground cursor-pointer font-normal leading-none">Remember me for 30 days</Label>
                </div>
              )}

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

              <Button type="submit" className="login-cta login-rise login-press w-full h-11 text-base font-semibold" style={{ "--rise-index": 5 } as React.CSSProperties} disabled={authBusy}>
                {authBusy && !passkeyLoading ? <Spinner data-icon="inline-start" /> : null}
                {primaryButtonLabel}
              </Button>

              {isIdentity && passkeySupported && (
                <>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                    <div className="h-px flex-1 bg-border" />
                    <span>or</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <Button type="button" variant="outline" className="w-full h-11 text-base font-semibold" onClick={handlePasskeySignIn} disabled={authBusy}>
                    {passkeyLoading ? <Spinner data-icon="inline-start" /> : <KeyRound className="size-4" />}
                    {passkeyLoading ? "Waiting for passkey…" : "Continue with passkey"}
                  </Button>

                  {passkeyError && (
                    <Alert variant="destructive" className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
                      <AlertCircle className="size-4" />
                      <AlertDescription>{passkeyError}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </form>
    </AuthScreen>
  );
}
