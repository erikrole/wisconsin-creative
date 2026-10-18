import { Role } from "@prisma/client";
import { Lato } from "next/font/google";
import { requireAuth } from "@/lib/auth";
import StaffNav from "./StaffNav";
import StaffTheme from "./StaffTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <StaffTheme classNames={`wc-fresh ${lato.variable}`} />
      <StaffNav isAdmin={user.role === Role.ADMIN} />
      {children}
    </div>
  );
}
