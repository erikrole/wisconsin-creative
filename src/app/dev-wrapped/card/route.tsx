import { notFound } from "next/navigation";
import { renderWrappedShareImage } from "@/lib/wrapped/share-image";
import { WRAPPED_SCENARIOS, wrappedScenario } from "@/lib/wrapped/stress-fixtures";

// Dev-only: the share image for a synthetic scenario (`?s=huge`), so the PNG
// can be reviewed without a database or a signed-in person.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") notFound();
  const requested = new URL(req.url).searchParams.get("s");
  const recap = wrappedScenario(WRAPPED_SCENARIOS.find((name) => name === requested) ?? "huge");
  const summary = recap.cards.find((card) => card.layout === "summary");
  if (!summary) return new Response("No summary card for this scenario", { status: 404 });
  return renderWrappedShareImage(recap.person, summary);
}
