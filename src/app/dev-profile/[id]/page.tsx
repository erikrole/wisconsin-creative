import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import ProfileLab from "./ProfileLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: a student's profile in the app shell with sample data, reviewable without a database. Open /dev-profile/u-maddy.
export default function DevProfilePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProfileLab fontClass={lato.variable} />;
}
