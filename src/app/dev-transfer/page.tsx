import { notFound } from "next/navigation";
import TransferLab from "./TransferLab";

// Dev-only: the transfer picker with sample people, reviewable without a database.
export default function DevTransferPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TransferLab />;
}
