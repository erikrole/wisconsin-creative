import { BookingKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { csvField } from "@/lib/csv";

const EXPORT_LIMIT = 5000;

const bookingExportQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  kind: z.nativeEnum(BookingKind).optional(),
}).superRefine((query, ctx) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "to must be on or after from",
    });
  }
});

export const GET = withAuth(async (req, { user }) => {
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin access required");
  await enforceRateLimit(`bookings:export:${user.id}`, { max: 5, windowMs: 60_000 });

  const { searchParams } = new URL(req.url);
  const query = bookingExportQuerySchema.parse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    kind: searchParams.get("kind") ?? undefined,
  });

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;

  const where = {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    } : {}),
  };

  const [bookings, totalCount] = await Promise.all([
    db.booking.findMany({
      where,
      select: {
        refNumber: true,
        kind: true,
        title: true,
        status: true,
        custodyScope: true,
        startsAt: true,
        endsAt: true,
        notes: true,
        createdAt: true,
        completedAt: true,
        requester: { select: { name: true, email: true } },
        location: { select: { name: true } },
        serializedItems: { select: { asset: { select: { assetTag: true, name: true } } } },
        bulkItems: {
          select: {
            plannedQuantity: true,
            bulkSku: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
    }),
    db.booking.count({ where }),
  ]);

  const truncated = totalCount > EXPORT_LIMIT;

  const headers = [
    "Ref #", "Kind", "Title", "Requester", "Requester Email",
    "Location", "Status", "Starts At", "Ends At",
    "Serialized Items", "Bulk Items", "Notes", "Created At", "Completed At",
  ];

  const rows = bookings.map((b) => {
    const serialized = b.serializedItems.map((s) => `${s.asset.assetTag} – ${s.asset.name || ""}`.trim()).join("; ");
    const bulk = b.bulkItems.map((bi) => `${bi.bulkSku.name} ×${bi.plannedQuantity}`).join("; ");
    return [
      csvField(b.refNumber || ""),
      csvField(b.kind),
      csvField(b.title),
      csvField(b.custodyScope === "SHARED" ? "Shared checkout" : b.requester.name),
      csvField(b.custodyScope === "SHARED" ? "" : b.requester.email),
      csvField(b.location.name),
      csvField(b.status),
      csvField(b.startsAt.toISOString()),
      csvField(b.endsAt.toISOString()),
      csvField(serialized),
      csvField(bulk),
      csvField(b.notes || ""),
      csvField(b.createdAt.toISOString()),
      csvField(b.completedAt?.toISOString() || ""),
    ];
  });

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookings-export-${date}.csv"`,
      ...(truncated ? { "X-Total-Count": String(totalCount), "X-Truncated": "true" } : {}),
    },
  });
});
