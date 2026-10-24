import { kitCountsForFit, type GearPickFitKey } from "@/lib/gear-picks/catalog";

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold";

/**
 * The designation vocabulary for what the department gives a person:
 * standard issue (dashed grey, $0 to the budget), core kit (purple), and their own picks (teal).
 */
function StandardIssuePill({ count }: { count: number }) {
  return (
    <span className={`${PILL} border border-dashed border-[#BFC1CC] bg-[#F7F7F9] text-[#60646C] dark:border-white/25 dark:bg-white/5 dark:text-muted-foreground`}>
      Standard issue · {count}
    </span>
  );
}

function CoreKitPill({ count }: { count: number }) {
  return <span className={`${PILL} bg-[#F3EBFB] text-[#6E3AA8] dark:bg-[#8E4EC6]/20 dark:text-[#CBA8EE]`}>Core kit · {count}</span>;
}

function PicksPill({ count }: { count: number }) {
  return <span className={`${PILL} bg-[#E3F6F3] text-[#0B7A6D] dark:bg-[#12A594]/20 dark:text-[#6FD6C8]`}>Picks · {count}</span>;
}

/** Standard issue for everyone, a core kit where the fit has one, and the person's picks when they have any. */
export function KitPills({ fit, pickCount }: { fit: GearPickFitKey; pickCount: number }) {
  const { standardIssue, coreKit } = kitCountsForFit(fit);
  return (
    <div className="flex flex-wrap gap-1.5">
      <StandardIssuePill count={standardIssue} />
      {coreKit > 0 && <CoreKitPill count={coreKit} />}
      {pickCount > 0 && <PicksPill count={pickCount} />}
    </div>
  );
}
