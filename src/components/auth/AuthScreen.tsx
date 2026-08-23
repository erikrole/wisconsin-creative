import Image from "next/image";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Film grain over the login scene. The gradient background alone bands on
 * wide displays; the noise breaks it up. Inline because it is a single
 * self-contained texture with no other consumer.
 */
const NOISE_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

interface AuthScreenProps {
  /** Line under the wordmark saying what this screen is for. */
  subtitle: string;
  /** Form content, rendered inside the translucent card. */
  children: ReactNode;
  /** Extra classes for the card content well. */
  contentClassName?: string;
  /** Content below the card, rendered on the scene rather than inside it. */
  footer?: ReactNode;
}

/**
 * The shared shell for every unauthenticated screen.
 *
 * The login scene is a designed system in `globals.css` — `.login-card` is a
 * translucent material over the gradient, `.login-materialize` settles it into
 * place, `.login-rise` staggers the content, and `.login-lockup-title` puts the
 * wordmark on the scene rather than inside the card. Sign-in used all of it
 * while password reset, forgot password, and forced password change each
 * reimplemented a plainer card, so the branding shifted between steps of the
 * same flow. Every unauthenticated screen renders through this component.
 */
export function AuthScreen({ subtitle, children, contentClassName, footer }: AuthScreenProps) {
  return (
    <main className="login-bg min-h-screen flex items-center justify-center p-4">
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: NOISE_TEXTURE,
          backgroundRepeat: "repeat",
          backgroundSize: "256px",
        }}
      />

      <div className="relative w-full max-w-[420px] flex flex-col items-center">
        <div
          className="login-rise flex flex-col items-center text-center mb-7"
          style={{ "--rise-index": 0 } as React.CSSProperties}
        >
          <Image
            src="/Badgers.png"
            alt="Wisconsin"
            width={64}
            height={64}
            className="size-16 object-contain drop-shadow-lg mb-4"
            priority
          />
          <h1 className="login-lockup-title text-[1.875rem] leading-tight">Wisconsin Creative</h1>
          <p className="text-[0.9375rem] text-white/65 mt-1">{subtitle}</p>
        </div>

        <Card data-theme="light" className="login-card login-materialize w-full border-0">
          <CardContent className={cn("pt-6", contentClassName)}>{children}</CardContent>
        </Card>

        {footer}
      </div>
    </main>
  );
}
