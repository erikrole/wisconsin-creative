import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { WishlistView } from "./WishlistView";

export const metadata = { title: "Wish list" };

/** Staff and admins add what they'd like bought; admins review wishes and move them into the budget. */
export default async function WishlistPage() {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN && user.role !== Role.STAFF) redirect("/");
  return <WishlistView isAdmin={user.role === Role.ADMIN} currentUserId={user.id} />;
}
