import { CheckCircle2Icon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormRow({
  label,
  required,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const labelContent = (
    <>
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-1.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium sm:pt-2.5">
          {labelContent}
        </Label>
      ) : (
        <span className="text-sm font-medium sm:pt-2.5">
          {labelContent}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FormRow2Col({
  label,
  required,
  htmlFor,
  children,
}: {
  label?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const labelContent = (
    <>
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-1.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium sm:pt-2.5">
          {labelContent}
        </Label>
      ) : (
        <span className="text-sm font-medium sm:pt-2.5">
          {labelContent}
        </span>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function FormFieldError({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} className="mt-1.5 text-sm text-destructive">
      {children}
    </p>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm text-muted-foreground uppercase tracking-wider">
      {children}
    </h3>
  );
}

export function SuccessFlash({ message }: { message: string }) {
  return (
    <Alert className="border-[var(--green)]/20 bg-[var(--green-bg)] text-[var(--green-text)]">
      <CheckCircle2Icon className="size-4 shrink-0" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
