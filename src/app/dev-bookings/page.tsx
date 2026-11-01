import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import BookingsLab from "./BookingsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Bookings list in the app shell with sample checkouts and reservations, reviewable without a database.
export default function DevBookingsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BookingsLab fontClass={lato.variable} />;
}
