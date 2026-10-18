import { useMemo } from "react";
import { GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import { SIZE_NEEDED, buildOrderPlan, type OrderSource } from "@/lib/gear-picks/order";
import type { GearPickAdminParticipant } from "@/lib/gear-picks/types";

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const HEAD = "text-[11px] font-bold uppercase tracking-[0.09em] text-[#6B6F7A] dark:text-muted-foreground";
const ROW = "grid grid-cols-[minmax(180px,1.5fr)_130px_minmax(160px,2fr)_56px_90px] items-center gap-3.5 border-b border-[#F0F1F3] px-5 py-3 text-sm last:border-b-0 dark:border-white/10";

const SOURCE: Record<OrderSource, { label: string; className: string }> = {
  STANDARD_ISSUE: { label: "Standard issue", className: "border border-dashed border-[#BFC1CC] bg-[#F7F7F9] text-[#60646C] dark:bg-white/5 dark:text-muted-foreground" },
  CORE_KIT: { label: "Core kit", className: "bg-[#F3EBFB] text-[#6E3AA8] dark:bg-[#8E4EC6]/20 dark:text-[#D9BFF2]" },
  PICK: { label: "Pick", className: "bg-[#EEF1FD] text-[#3E63DD] dark:bg-[#3E63DD]/20 dark:text-[#AEBDF5]" },
};

/** One quantity per item, color and size for the staff order: kits from each fit and profile, plus saved picks. */
export function OrderPlan({ participants }: { participants: GearPickAdminParticipant[] }) {
  const plan = useMemo(() => buildOrderPlan(participants, GEAR_CATALOG.kits), [participants]);

  return (
    <section aria-labelledby="gear-admin-order" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="gear-admin-order" className="text-[22px] font-extrabold tracking-[-0.03em]">Order</h2>
        <span className="text-sm text-[#60646C] dark:text-muted-foreground">
          {plan.pieces} pieces · {usd(plan.pickCents)} from picks
        </span>
      </div>
      {plan.missingSizePeople.length > 0 && (
        <p className="mb-2 rounded-[10px] border border-dashed border-[#E5B84A] bg-[#FFFBEA] px-3.5 py-2 text-[13px] text-[#AB6400] dark:bg-[#AB6400]/10">
          {plan.missingSizePeople.length} {plan.missingSizePeople.length === 1 ? "person has" : "people have"} no size on file, so their kit pieces show as “{SIZE_NEEDED}”: {plan.missingSizePeople.join(", ")}.
        </p>
      )}
      {plan.lines.length === 0 ? (
        <div className={`${CARD} px-5 py-8 text-center text-sm text-[#60646C] dark:text-muted-foreground`}>
          Nothing to order yet. Add people to the pick list and their kits appear here.
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <div className="min-w-[720px]">
            <div className={`${ROW} bg-[#FAFAFB] dark:bg-white/5`}>
              <span className={HEAD}>Item</span>
              <span className={HEAD}>For</span>
              <span className={HEAD}>Sizes</span>
              <span className={`${HEAD} text-right`}>Qty</span>
              <span className={`${HEAD} text-right`}>Cost</span>
            </div>
            {plan.lines.map((line) => (
              <div key={`${line.source}-${line.sku}`} className={ROW}>
                <span>
                  <span className="font-bold">{line.itemName}</span>
                  {line.colorLabel && <span className="ml-2 text-xs text-[#8B8D98]">{line.colorLabel}</span>}
                </span>
                <span className={`w-fit rounded-md px-2 py-0.5 text-xs font-bold ${SOURCE[line.source].className}`}>{SOURCE[line.source].label}</span>
                <span className="flex flex-wrap gap-1">
                  {line.sizes.map((entry) => (
                    <span
                      key={entry.size}
                      className={`rounded-md px-1.5 py-0.5 font-mono text-xs ${entry.size === SIZE_NEEDED ? "border border-dashed border-[#E5B84A] bg-[#FFFBEA] text-[#AB6400]" : "bg-[#F0F1F3] dark:bg-white/10"}`}
                    >
                      {entry.size} × {entry.quantity}
                    </span>
                  ))}
                </span>
                <span className="text-right font-mono">{line.quantity}</span>
                <span className="text-right font-mono text-[13px]">{usd(line.totalCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-[#8B8D98]">Staff only for now. Student kits join once their items are chosen. Kit prices are what the department pays, not the budget.</p>
    </section>
  );
}
