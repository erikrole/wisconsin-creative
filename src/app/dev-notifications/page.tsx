import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import NotificationsLab from "./NotificationsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Notifications inbox in the app shell with sample notifications, reviewable without a database.
export default function DevNotificationsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NotificationsLab fontClass={lato.variable} />;
}
