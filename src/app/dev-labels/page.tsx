import { notFound } from "next/navigation";
import FreshLayout from "@/components/FreshLayout";
import LabelsLab from "./LabelsLab";

// Dev-only: renders Print labels with sample gear and units so it can be reviewed without a database.
export default function DevLabelsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <FreshLayout>
      <LabelsLab />
    </FreshLayout>
  );
}
