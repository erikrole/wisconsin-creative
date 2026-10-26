import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import WrappedLab from "./WrappedLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: plays Creative Wrapped from synthetic extremes (nothing, one shift,
// huge, long text, collaborator) so the story can be reviewed without a database.
export default function DevWrappedPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <WrappedLab />
    </div>
  );
}
