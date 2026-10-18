import { gearAttentionItems } from "@/lib/gear-picks/attention";
import type { GearPicksAdminResponse } from "@/lib/gear-picks/types";

const DOT = { red: "bg-[#C62A2F]", amber: "bg-[#F5B800]", blue: "bg-[#3E63DD]" } as const;

/** A short, ordered list of what to look at next; collapses to a calm line when nothing is wrong. */
export function NeedsAttention({ data }: { data: Pick<GearPicksAdminResponse, "cycle" | "summary" | "budget" | "students"> }) {
  const items = gearAttentionItems(data);

  return (
    <section
      aria-labelledby="gear-admin-attention"
      className="mb-4 overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card"
    >
      <div className="flex items-center justify-between border-b border-[#E8E8EC] px-5 py-3.5 dark:border-white/10">
        <h2 id="gear-admin-attention" className="text-base font-bold">Needs attention</h2>
        {items.length > 0 && <span className="font-mono text-xs text-[#60646C] dark:text-muted-foreground">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2.5 px-5 py-3.5 text-sm text-[#218358]">
          <span aria-hidden className="size-2 rounded-full bg-[#30A46C]" />
          Nothing needs attention.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key} className="border-b border-[#F0F1F3] last:border-b-0 dark:border-white/10">
              <a href={item.href} className="flex items-center gap-2.5 px-5 py-3 text-sm hover:bg-[#FAFAFC] dark:hover:bg-white/5">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[item.tone]}`} />
                <span className="flex-1">{item.text}</span>
                <span aria-hidden className="text-[#8B8D98]">›</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
