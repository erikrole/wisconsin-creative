import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { IssueDetailView } from "./IssueDetailView";

export const metadata = { title: "Issue" };

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");
  const { id } = await params;
  return <IssueDetailView id={id} />;
}
