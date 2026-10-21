import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getGuideBySlug } from "@/lib/guides";
import { HttpError } from "@/lib/http";
import { Role } from "@prisma/client";
import { BreadcrumbLabel } from "@/components/BreadcrumbContext";
import { GuideReader } from "./_components/GuideReader";

type Props = { params: Promise<{ slug: string }> };

export default async function GuideReaderPage({ params }: Props) {
  const { slug } = await params;

  const user = await requireAuth();

  let guide;
  try {
    guide = await getGuideBySlug(slug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  // Students cannot access unpublished guides
  if (user.role === Role.STUDENT && !guide.published) {
    notFound();
  }

  const canEdit =
    user.role === Role.ADMIN ||
    (user.role === Role.STAFF && guide.authorId === user.id);

  return (
    <>
      <BreadcrumbLabel label={guide.title} />
      <GuideReader
        guide={guide}
        canEdit={canEdit}
        slug={slug}
      />
    </>
  );
}
