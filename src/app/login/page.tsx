import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { tokenHash } from "@/lib/auth";
import { safeReturnTo } from "@/lib/return-to";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Wisconsin Creative",
  description: "Sign in to the Wisconsin Creative app — the UW Athletics inventory and booking system.",
};

async function hasActiveSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;
  if (!token) return false;

  try {
    const hashed = await tokenHash(token);
    const session = await db.session.findUnique({
      where: { tokenHash: hashed },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return false;
    return session.user.active;
  } catch {
    return false;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  if (await hasActiveSession()) {
    const { returnTo } = await searchParams;
    redirect(safeReturnTo(typeof returnTo === "string" ? returnTo : null) ?? "/");
  }
  return <LoginForm />;
}
