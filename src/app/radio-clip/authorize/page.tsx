import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { authorizationInput } from "@/lib/radio-clip-contract";
import { requireRadioClipEnabled } from "@/lib/services/radio-clip-auth";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { AuthorizeRadioClip } from "./AuthorizeRadioClip";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in to Radio Clip", referrer: "no-referrer" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = authorizationInput.safeParse(await searchParams);
  if (!parsed.success) return <AuthScreen subtitle="Radio Clip"><p>This sign-in link is invalid. Start again in Radio Clip.</p></AuthScreen>;
  try { requireRadioClipEnabled(); } catch { return <AuthScreen subtitle="Radio Clip"><p>Radio Clip sign-in is not available yet. Your local projects remain available.</p></AuthScreen>; }
  let user;
  try { user = await requireAuth(); } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    const next = `/radio-clip/authorize?${new URLSearchParams(parsed.data)}`;
    redirect(`/login?returnTo=${encodeURIComponent(next)}`);
  }
  return <AuthScreen subtitle="Sign in to Radio Clip"><AuthorizeRadioClip input={parsed.data} name={user.name} /></AuthScreen>;
}
