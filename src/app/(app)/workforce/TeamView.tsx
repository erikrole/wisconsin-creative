"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { academicYearLabel } from "@/lib/workforce/planning";
import type { TeamViewData } from "@/lib/workforce/team";
import { TERM_LABELS } from "@/lib/hiring/contract";
import { AREA_LABEL, AREA_OPTIONS } from "./hiring/types";
import { PersonCard } from "./PersonCard";

export default function TeamView({ view, years, openings, importAction }: {
  view: TeamViewData; years: number[];
  openings: { id: string; label: string; status: string }[]; importAction?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { selection, mode } = view;
  const termLabel = `${TERM_LABELS[selection.term]} ${selection.year}`;
  function navigate(year: number, term = selection.term) {
    startTransition(() => router.push(`/workforce?year=${year}&term=${term}`));
  }
  const query = search.trim().toLowerCase();
  const members = view.people.filter(p => (!area || (p.area ?? "NONE") === area) && (!query || `${p.name} ${p.title ?? ""} ${p.manager ?? ""} ${p.sports.join(" ")}`.toLowerCase().includes(query)));
  const areaKeys = [...AREA_OPTIONS.map(a => a.value as string), "NONE"].filter(key => members.some(p => (p.area ?? "NONE") === key));
  const caption = mode === "past"
    ? "Recorded intern placements for this term. Staff history is not recorded; names and graduation details reflect current profiles."
    : mode === "future"
      ? "Recorded placements plus projected returning interns, using start and graduation dates. Staff are shown from today’s team. Hires awaiting accounts appear in Looking ahead."
      : "Your active team, with intern areas and sports from this term’s placements where recorded.";
  return (
    <>
      <PageHeader title="Creative team" description="See how your team is staffed, where interns are working, and what changes next.">
        <Button asChild variant="outline"><Link href="/workforce/planning">Look ahead <ArrowRight className="size-4" aria-hidden /></Link></Button>
      </PageHeader>
      <section aria-label="Team period and filters" className="mb-5 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous academic year" disabled={pending || selection.academicYear <= 2000} onClick={() => navigate(selection.academicYear - 1)}><ChevronLeft className="size-4" aria-hidden /></Button>
            <NativeSelect aria-label="Academic year" value={selection.academicYear} disabled={pending} className="w-36" onChange={e => navigate(Number(e.target.value))}>
              {years.map(year => <option key={year} value={year}>{academicYearLabel(year)}</option>)}
            </NativeSelect>
            <Button variant="outline" size="icon" aria-label="Next academic year" disabled={pending || selection.academicYear >= 2099} onClick={() => navigate(selection.academicYear + 1)}><ChevronRight className="size-4" aria-hidden /></Button>
            <NativeSelect aria-label="Team term" className="w-36" value={selection.term} disabled={pending} onChange={e => navigate(selection.academicYear, e.target.value as typeof selection.term)}>
              {(["FALL", "WINTER", "SPRING", "SUMMER"] as const).map(term => <option key={term} value={term}>{TERM_LABELS[term]} {selection.academicYear + (term === "FALL" ? 0 : 1)}</option>)}
            </NativeSelect>
            {mode !== "current" && <Button variant="ghost" disabled={pending} onClick={() => navigate(view.current.academicYear, view.current.term)}>Current team</Button>}
          </div>
          <Badge variant={mode === "future" ? "blue" : "gray"}>{mode === "past" ? "Recorded history" : mode === "future" ? "Looking ahead" : "Current term"}</Badge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground" role="status">{pending ? "Loading team…" : caption}</p>
        <Button variant="ghost" className="mt-2 sm:hidden" aria-expanded={filtersOpen} aria-controls="team-filters" onClick={() => setFiltersOpen(open => !open)}><Search className="size-4" aria-hidden />Search and filters{query || area ? " · Active" : ""}</Button>
        <div id="team-filters" className={`${filtersOpen ? "flex" : "hidden"} mt-4 flex-wrap items-center gap-2 border-t pt-4 sm:flex`}>
          <div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search team" placeholder="Find a person, role, or sport" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NativeSelect className="w-44" aria-label="Team area" value={area} onChange={e => setArea(e.target.value)}><option value="">All areas</option>{AREA_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}<option value="NONE">No area set</option></NativeSelect>
          {(query || area) && <Button variant="ghost" onClick={() => { setSearch(""); setArea(""); }}>Clear filters</Button>}
          <div className="sm:ml-auto">{importAction}</div>
        </div>
      </section>
      <div aria-busy={pending} className={pending ? "opacity-60" : undefined}>
        <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border bg-card px-5 py-4" aria-label={`${termLabel} totals across all areas`}>
          {[
            ...(mode === "past" ? [] : [["Staff", view.staffCount]]),
            [mode === "past" ? "Recorded interns" : mode === "future" ? "Interns expected" : "Interns", view.studentCount],
            ...(mode === "past" ? [] : [[`Graduating by ${selection.academicYear + 1}`, view.graduatingCount]]),
            ...(mode === "past" ? [["Areas represented", new Set(view.people.flatMap(p => p.area ? [p.area] : [])).size]] : []),
          ].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
        </dl>
        {view.uncertainCount > 0 && <p className="mb-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{view.uncertainCount} projected {view.uncertainCount === 1 ? "intern is" : "interns are"} missing a complete graduation date. They are included as potentially returning.</p>}
        {members.length === 0 ? <EmptyState icon="users" title={query || area ? "No matching teammates" : mode === "past" ? "No intern placements recorded for this term" : "No team members for this term"} description={query || area ? "Try another name or area, or clear the filters." : mode === "past" ? "Import that year’s roster or add term placements from a person’s current profile. An empty history does not mean the team was unstaffed." : "Active staff and interns, plus recorded term placements, appear here."} /> : (
          <div className="grid items-start gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {areaKeys.map(key => {
              const inArea = members.filter(p => (p.area ?? "NONE") === key);
              const staff = inArea.filter(p => p.kind === "FULL_TIME");
              const students = inArea.filter(p => p.kind === "STUDENT");
              return <section key={key} aria-label={`${AREA_LABEL[key] ?? "No area set"} team`} className="min-w-0 rounded-xl border bg-card">
                <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3"><h2 className="text-base font-semibold">{AREA_LABEL[key] ?? "No area set"}</h2><span className="shrink-0 text-xs text-muted-foreground">{inArea.length} {inArea.length === 1 ? "person" : "people"}</span></div>
                {mode !== "past" && <div className="p-3"><h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">Staff · {staff.length}</h3>{staff.length ? <ul className="grid gap-2">{staff.map(person => <li key={person.id}><PersonCard person={{ ...person, standing: null, academicYearEnd: selection.academicYear + 1, selectedTerm: selection.term, selectedYear: selection.year, historical: false }} /></li>)}</ul> : <p className="px-1 pb-1 text-sm text-muted-foreground">No staff assigned to this area.</p>}</div>}
                <div className={mode === "past" ? "p-3" : "border-t bg-muted/20 p-3"}><h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">Interns · {students.length}</h3>{students.length ? <ul className="grid gap-2">{students.map(person => <li key={person.id}><PersonCard person={{ ...person, standing: null, academicYearEnd: selection.academicYear + 1, selectedTerm: selection.term, selectedYear: selection.year, historical: mode === "past" }} /></li>)}</ul> : <p className="px-1 pb-1 text-sm text-muted-foreground">No interns {mode === "future" ? "expected" : "assigned"} for this term.</p>}</div>
              </section>;
            })}
          </div>
        )}
      </div>
      <section aria-label="Hiring openings" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div><h2 className="text-base font-semibold">Hiring</h2><p className="mt-1 text-sm text-muted-foreground">{openings.length ? "Openings and candidates, organized by hiring cycle." : "Create an opening when you’re ready to grow the team."}</p></div>
        <div className="flex flex-wrap gap-2">{openings.map(opening => <Button key={opening.id} asChild variant="outline"><Link href={`/workforce/hiring?cycle=${encodeURIComponent(opening.id)}`}>{opening.label}{opening.status === "PLANNING" ? " · Planning" : ""}<ArrowRight className="size-4" aria-hidden /></Link></Button>)}<Button asChild variant="ghost"><Link href="/workforce/hiring">All hiring</Link></Button></div>
      </section>
    </>
  );
}
