import { Role } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import StaffNav from "./StaffNav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  return (
    <>
      <StaffNav isAdmin={user.role === Role.ADMIN} />
      {children}
    </>
  );
}
