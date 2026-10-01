import HiringClient from "./HiringClient";

export const metadata = { title: "Hiring" };

/** Admin-only via the Workforce layout (D-065). */
export default function HiringPage() {
  return <HiringClient />;
}
