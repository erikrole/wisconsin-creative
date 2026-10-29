"use client";

import { useState } from "react";
import { CrewTagEditor } from "@/components/shift-detail/CrewTag";
import type { CrewTagValue } from "@/lib/crew-label";

const CREW = [
  { name: "Maddy Pehler", tags: [{ label: "SLOW1", half: "FIRST" }, { label: "CAM3", half: "SECOND" }] },
  { name: "Jordan Reyes", tags: [{ label: "ROAM2", half: null }] },
  { name: "Sam Oyelaran", tags: [] },
] satisfies Array<{ name: string; tags: CrewTagValue[] }>;

export default function CrewTagsLab() {
  const [crew, setCrew] = useState<Array<{ name: string; tags: CrewTagValue[] }>>(CREW);
  return (
    <div className="wc-fresh mx-auto max-w-md space-y-2 p-6">
      {crew.map((person, index) => (
        <div key={person.name} className="flex items-center gap-2 text-sm">
          <span>{person.name}</span>
          <CrewTagEditor
            tags={person.tags}
            othersTags={crew.filter((_, i) => i !== index).map((o) => ({ name: o.name, tags: o.tags }))}
            personName={person.name}
            disabled={false}
            onSave={(tags) => setCrew((rows) => rows.map((row, i) => (i === index ? { ...row, tags } : row)))}
          />
        </div>
      ))}
    </div>
  );
}
