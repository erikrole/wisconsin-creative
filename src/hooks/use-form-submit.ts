"use client";

import { useCallback, useRef, useState } from "react";
import { type ZodSchema, ZodError } from "zod";
import {
  classifyError,
  handleAuthRedirect,
  parseErrorMessage,
  parseJsonSafely,
} from "@/lib/errors";
import { toast } from "sonner";

export type FormState = "idle" | "submitting" | "success" | "error";

type FieldErrors = Record<string, string>;

type UseFormSubmitOptions<TInput, TOutput = unknown> = {
  /** Zod schema for client-side validation (optional — skip for server-only validation). */
  schema?: ZodSchema<TInput>;
  /** The API endpoint URL. */
  url: string;
  /** HTTP method. Default: "POST". */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Transform form data before sending to API. Default: JSON.stringify the validated data. */
  transformBody?: (data: TInput) => Record<string, unknown>;
  /** Path for 401 redirect returnTo param. Default: current pathname. */
  returnTo?: string;
  /** Skip the automatic 401 → /login redirect (use for auth pages themselves). */
  skipAuthRedirect?: boolean;
  /** Toast message on success. Omit to skip toast. */
  successMessage?: string;
  /** Called after successful submission with the parsed response data. */
  onSuccess?: (data: TOutput) => void;
  /** Called on error (after toast). Receives the error kind. */
  onError?: (kind: "validation" | "network" | "server" | "auth", message?: string) => void;
};

type UseFormSubmitResult<TInput> = {
  /** Current form state. */
  state: FormState;
  /** Whether the form is currently submitting (convenience alias). */
  submitting: boolean;
  /** Per-field validation errors from Zod. */
  fieldErrors: FieldErrors;
  /** General form-level error message. */
  formError: string;
  /** Clear all errors (useful on form reset or input change). */
  clearErrors: () => void;
  /** Submit the form with the given data. Validates, sends, and handles response. */
  submit: (data: TInput) => Promise<boolean>;
};

/**
 * Shared form submission hook.
 *
 * Handles the full lifecycle: client-side Zod validation → fetch with auth redirect →
 * error classification → toast feedback → field-level error display.
 *
 * @example
 * ```tsx
 * const { submit, submitting, fieldErrors, formError } = useFormSubmit({
 *   schema: createUserSchema,
 *   url: "/api/users",
 *   successMessage: "User created",
 *   onSuccess: (data) => { closeDialog(); refresh(); },
 * });
 *
 * <form onSubmit={(e) => { e.preventDefault(); submit({ name, email, role }); }}>
 *   <Input error={fieldErrors.name} ... />
 *   {formError && <Alert>{formError}</Alert>}
 *   <Button disabled={submitting}>Create</Button>
 * </form>
 * ```
 */
export function useFormSubmit<TInput, TOutput = unknown>(
  options: UseFormSubmitOptions<TInput, TOutput>,
): UseFormSubmitResult<TInput> {
  const {
    schema,
    url,
    method = "POST",
    transformBody,
    returnTo,
    skipAuthRedirect,
    successMessage,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<FormState>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const busyRef = useRef(false);

  const clearErrors = useCallback(() => {
    setFieldErrors({});
    setFormError("");
  }, []);

  const submit = useCallback(async (data: TInput): Promise<boolean> => {
    // Prevent double-submit
    if (busyRef.current) return false;
    busyRef.current = true;
    clearErrors();
    setState("submitting");

    try {
      // 1. Client-side validation
      let validated: TInput = data;
      if (schema) {
        try {
          validated = schema.parse(data);
        } catch (err) {
          if (err instanceof ZodError) {
            const errors: FieldErrors = {};
            for (const issue of err.issues) {
              const key = issue.path.join(".");
              if (!errors[key]) errors[key] = issue.message;
            }
            setFieldErrors(errors);
            setState("error");
            onError?.("validation");
            return false;
          }
          throw err;
        }
      }

      // 2. Submit to API
      const body = transformBody ? transformBody(validated) : validated;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!skipAuthRedirect && handleAuthRedirect(res, returnTo)) {
        return false;
      }

      if (!res.ok) {
        // Clone before parseErrorMessage consumes the body — we need fieldErrors too
        const json = await parseJsonSafely<Record<string, unknown>>(res.clone()) ?? {};
        const serverMsg = await parseErrorMessage(res, "Something went wrong. Please try again.");

        // Map server-side field errors if present
        if (json.fieldErrors) {
          setFieldErrors(json.fieldErrors as FieldErrors);
        }

        setFormError(serverMsg);
        setState("error");
        toast.error(serverMsg);
        onError?.("server", serverMsg);
        return false;
      }

      // 3. Success
      const responseData = await parseJsonSafely<Record<string, unknown>>(res) ?? {};
      setState("success");
      if (successMessage) toast.success(successMessage);
      onSuccess?.((responseData as Record<string, unknown>).data as TOutput ?? responseData as TOutput);
      return true;
    } catch (err) {
      const kind = classifyError(err);
      const msg = kind === "network"
        ? "You\u2019re offline. Check your connection and try again."
        : "Something went wrong. Please try again.";
      setFormError(msg);
      setState("error");
      toast.error(msg);
      onError?.(kind);
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [schema, url, method, transformBody, returnTo, skipAuthRedirect, successMessage, onSuccess, onError, clearErrors]);

  return {
    state,
    submitting: state === "submitting",
    fieldErrors,
    formError,
    clearErrors,
    submit,
  };
}
