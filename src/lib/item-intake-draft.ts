import { z } from "zod";
const text = z.string().max(20_000).default("");
const unit = z.object({ key: text, assetTag: text, serialNumber: text, qrCodeValue: text, uwAssetTag: text });
export const serializedDraftSchema = z.object({
  categoryId: text, locationId: text, departmentId: text, fiscalYear: text,
  itemName: text, brand: text, model: text, purchaseDate: text, purchasePrice: text,
  warrantyDate: text, residualValue: text, linkUrl: text, userNotes: text,
  units: z.array(unit).min(1).max(25),
  availableForReservation: z.boolean(), availableForCheckout: z.boolean(), availableForCustody: z.boolean(),
  isAccessory: z.boolean(), parentAsset: z.object({ id: text, assetTag: text, name: z.string().nullable(), brand: text, model: text }).nullable(),
});
export type SerializedDraft = z.infer<typeof serializedDraftSchema>;
export const bulkDraftSchema = z.object({ bulkMode: z.enum(["new", "existing"]), bulkName: text, categoryId: text, locationId: text, bulkQrCode: text, initialQuantity: text, selectedBulkSkuId: text, addQty: text, emptyFamily: z.boolean().default(false) });
export type BulkDraft = z.infer<typeof bulkDraftSchema>;
export const requestSchema = z.object({ key: z.string().uuid(), issuedAt: z.string().datetime(), url: z.string(), body: z.record(z.string(), z.unknown()), status: z.enum(["pending", "confirmed", "rejected"]).default("pending") });
export type IntakeRequest = z.infer<typeof requestSchema>;
const templateSchema = z.object({ key: text, sourceAssetId: z.string().optional(), batchSize: z.number().optional(), sourceLabel: text, productLabel: text, assetTag: text, name: text, brand: text, model: text, categoryId: text, locationId: text, departmentId: text, linkUrl: text, availableForReservation: z.boolean(), availableForCheckout: z.boolean(), availableForCustody: z.boolean() });
const handoffSchema = z.object({
  kind: z.enum(["standard", "units", "quantity"]), label: text, href: text, openLabel: text, successMessage: text, description: text, createdRecord: z.boolean(),
  imageEndpoint: z.string().nullable(), failedImageEndpoints: z.array(z.string()).optional(), imageStatus: z.enum(["none", "saved", "failed"]), imageError: text,
  labelIds: z.array(z.string()).optional(), numberedFamilyId: z.string().optional(), heading: z.string().optional(), repeatTemplate: templateSchema.optional(), continuationTemplate: templateSchema.optional(),
  batch: z.object({ attempted: z.number(), created: z.number(), failures: z.array(z.object({ unitKey: text, assetTag: text, message: text, fieldId: text })) }).optional(),
});
export const intakeDraftSchema = z.object({
  version: z.literal(1), savedAt: z.number(), kind: z.enum(["standard", "units", "quantity"]),
  serialized: serializedDraftSchema.optional(), bulk: bulkDraftSchema.optional(),
  image: z.object({ kind: z.literal("remote"), url: z.string().url(), previewUrl: z.string().url(), fallbackUrl: z.string().url().optional() }).nullable(),
  handoff: handoffSchema.optional(), deferredImageEndpoints: z.array(z.string()).default([]), batchContinuationTemplate: templateSchema.nullable().default(null),
  fileName: z.string().optional(), uncertain: z.boolean().default(false), requests: z.array(requestSchema).max(100),
});
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
export function readIntakeDraft(raw: string | null): IntakeDraft | null {
  if (!raw) return null;
  try {
    const parsed = intakeDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success && Date.now() - parsed.data.savedAt < 7 * 86400_000 ? parsed.data : null;
  } catch { return null; }
}
export function requestForPayload(requests: IntakeRequest[], url: string, body: Record<string, unknown>): IntakeRequest {
  const existing = requests.find(request => request.url === url && JSON.stringify(request.body) === JSON.stringify(body));
  if (existing) return existing;
  const request = { key: crypto.randomUUID(), issuedAt: new Date().toISOString(), url, body, status: "pending" as const };
  requests.push(request);
  return request;
}
