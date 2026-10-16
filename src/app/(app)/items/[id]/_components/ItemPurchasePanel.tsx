"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssetImage } from "@/components/AssetImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/budget/contract";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

type Proposal = {
  field: "purchaseDate" | "purchasePrice" | "linkUrl" | "notes";
  label: string;
  current: string | null;
  proposed: string;
  status: "fill" | "differs" | "same";
};
type Linked = {
  linkId: string;
  lineId: string;
  budgetId: string;
  supplier: string | null;
  orderNumber: string | null;
  autofill: Proposal[];
  budgetName: string;
  fiscalYear: string;
  description: string;
  unitCostCents: number;
  spentCents: number | null;
  poNumber: string | null;
  purchasedOn: string | null;
};
type Suggestion = {
  lineId: string;
  budgetName: string;
  fiscalYear: string;
  description: string;
  unitCostCents: number;
  purchasedOn: string | null;
  poNumber: string | null;
  confidence: "high" | "likely" | "possible";
  reasons: string[];
};
type Data = { serialNumber: string | null; imageUrl: string | null; linked: Linked[]; suggestions: Suggestion[] };

const CONFIDENCE_VARIANT = { high: "green", likely: "blue", possible: "gray" } as const;

/** Admin-only: where this item was bought, from the budget, with suggested purchases to link. */
export function ItemPurchasePanel({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const key = ["budget", "for-asset", assetId] as const;
  const [pending, setPending] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<Data | null>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/budget/for-asset/${assetId}`, { signal });
      if (handleAuthRedirect(response)) return null;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not load purchase details"));
      const json = await parseJsonSafely<{ data?: Data }>(response);
      return json?.data ?? null;
    },
  });

  async function mutate(id: string, request: () => Promise<Response>, success: string) {
    setPending(id);
    try {
      const response = await request();
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That change wasn't saved. Try again."));
        return;
      }
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ["budget"] });
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  if (isError) return null;

  return (
    <Card className="mt-3.5">
      <CardHeader>
        <CardTitle>Purchase</CardTitle>
        <CardDescription>
          Linked to the budget line that bought it. Open the line to see the whole budget. Only admins can see this.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading || !data ? (
          <Skeleton className="h-12 w-full" />
        ) : data.linked.length > 0 ? (
          data.linked.map((row) => {
            const open = row.autofill.filter((proposal) => proposal.status !== "same");
            const fillable = open.filter((proposal) => proposal.status === "fill");
            return (
              <div key={row.linkId} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <AssetImage src={data.imageUrl} alt="" size={48} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/budget?b=${row.budgetId}&line=${row.lineId}`}
                      className="truncate font-medium hover:underline"
                    >
                      {row.description}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[
                        `${row.budgetName} ${row.fiscalYear}`,
                        row.supplier,
                        row.poNumber,
                        row.orderNumber ? `Order ${row.orderNumber}` : null,
                        row.purchasedOn,
                        formatCents(row.spentCents ?? row.unitCostCents),
                        data.serialNumber ? `SN ${data.serialNumber}` : "No serial number yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending === row.linkId}
                    onClick={() =>
                      void mutate(row.linkId, () => fetch(`/api/budget/links/${row.linkId}`, { method: "DELETE" }), "Link removed.")
                    }
                  >
                    Unlink
                  </Button>
                </div>
                {open.length === 0 ? (
                  <p className="text-xs text-muted-foreground">This item already has everything from the order.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 border-t pt-2">
                    <p className="text-xs font-medium">From the order</p>
                    {open.map((proposal) => (
                      <p key={proposal.field} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{proposal.label}:</span> {proposal.proposed}
                        {proposal.status === "differs" && (
                          <span> (item has {proposal.current ?? "another value"}; not filled automatically)</span>
                        )}
                      </p>
                    ))}
                    {fillable.length > 0 && (
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending === `apply-${row.linkId}`}
                          onClick={() =>
                            void mutate(
                              `apply-${row.linkId}`,
                              () =>
                                fetch(`/api/budget/links/${row.linkId}/apply`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ fields: fillable.map((proposal) => proposal.field) }),
                                }),
                              "Item updated from the order.",
                            )
                          }
                        >
                          Fill {fillable.length} empty {fillable.length === 1 ? "field" : "fields"} from order
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : data.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not linked to a purchase yet, and no close matches in the budget.</p>
        ) : (
          data.suggestions.map((row) => (
            <div key={row.lineId} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{row.description}</span>
                  <Badge variant={CONFIDENCE_VARIANT[row.confidence]}>{row.confidence}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[`${row.budgetName} ${row.fiscalYear}`, row.poNumber, ...row.reasons].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button
                type="button"
                disabled={pending === row.lineId}
                onClick={() =>
                  void mutate(
                    row.lineId,
                    () =>
                      fetch(`/api/budget/lines/${row.lineId}/links`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ assetId }),
                      }),
                    "Linked.",
                  )
                }
              >
                Link
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
