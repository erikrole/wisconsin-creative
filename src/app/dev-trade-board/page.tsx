import { notFound } from "next/navigation";
import TradeBoardLab from "./TradeBoardLab";

// Dev-only: renders the Trade Board view with sample rows so it can be reviewed without a database.
export default function DevTradeBoardPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TradeBoardLab />;
}
