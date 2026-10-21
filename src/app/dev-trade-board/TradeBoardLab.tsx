"use client";

import { useEffect, useState } from "react";
import { TradeBoardView, type BoardRow, type BoardTab, type BoardTabSpec } from "@/components/trade-board/TradeBoardView";

const NOW = new Date("2026-10-21T15:00:00-05:00");
const noop = () => {};
const act = (label: string, busyLabel: string, variant: "primary" | "outline" | "danger") => ({
  label, busyLabel, variant, busy: false, disabled: false, onClick: noop,
});

const available: BoardRow[] = [
  {
    key: "a1", startsAt: "2026-10-22T16:00:00-05:00", title: "Men's Hockey vs Minnesota", detail: "Border Battle",
    times: "4:00 PM – 10:00 PM", area: "Photo", person: { name: "Maya Brandt" }, summary: "Maya Brandt can't work this",
    note: "Class conflict, sorry! Happy to cover one of yours.", notices: [], status: null,
    actions: [act("Claim", "Claiming…", "primary")],
  },
  {
    key: "a2", startsAt: "2026-10-23T11:00:00-05:00", title: "Volleyball vs Iowa", detail: null,
    times: "11:00 AM – 3:00 PM", area: "Photo", person: null, summary: "Open slot · 1 request so far",
    note: null, notices: [{ tone: "warn", text: "Overlaps your Thursday Econ 101 block (10:00 AM – 11:15 AM)." }], status: { label: "Open", variant: "green" },
    actions: [act("Claim", "Claiming…", "primary")],
  },
  {
    key: "a3", startsAt: "2026-10-25T13:00:00-05:00", title: "Football vs Ohio State", detail: null,
    times: "1:00 PM – 8:00 PM", area: "Photo", person: { name: "Jordan Ellis" }, summary: "Jordan Ellis can't work this",
    note: null, notices: [], status: null, actions: [act("Claim", "Claiming…", "primary")],
  },
  {
    key: "a4", startsAt: "2026-10-26T18:00:00-05:00", title: "Women's Basketball vs Purdue", detail: null,
    times: "6:00 PM – 9:30 PM", area: "Photo", person: { name: "Sam Okafor" }, summary: "Sam Okafor can't work this",
    note: null, notices: [{ tone: "block", text: "You are already scheduled for Hockey at that time." }],
    status: { label: "Can't claim", variant: "gray" }, muted: true, actions: [],
  },
];

const mine: BoardRow[] = [
  {
    key: "m1", startsAt: "2026-10-24T09:00:00-05:00", title: "Soccer vs Michigan", detail: null,
    times: "9:00 AM – 1:00 PM", area: "Photo", person: { name: "Priya Nair" },
    summary: "Priya Nair claimed it. Waiting on an admin", note: null, notices: [],
    status: { label: "Claimed", variant: "orange" }, actions: [],
    menuAction: act("Cancel post", "Cancelling…", "danger"),
  },
  {
    key: "m2", startsAt: "2026-10-27T17:00:00-05:00", title: "Men's Basketball vs Marquette", detail: null,
    times: "5:00 PM – 9:00 PM", area: "Photo", person: { name: "Erik Role" },
    summary: "Posted. You keep the shift until someone claims it and an admin approves", note: null, notices: [],
    status: { label: "Open", variant: "green" }, actions: [], menuAction: act("Cancel post", "Cancelling…", "danger"),
  },
  {
    key: "m3", startsAt: "2026-10-29T12:00:00-05:00", title: "Wrestling vs Iowa", detail: null,
    times: "12:00 PM – 4:00 PM", area: "Photo", person: { name: "Taylor Reed" },
    summary: "Your claim on Taylor Reed's shift", note: null,
    notices: [{ tone: "info", text: "Auto-approval check by Oct 28, 12:00 PM. You are not on the schedule until a decision lands." }],
    status: { label: "Waiting on admin", variant: "orange" }, actions: [act("Withdraw claim", "Withdrawing…", "outline")],
  },
];

const review: BoardRow[] = [
  {
    key: "r1", startsAt: "2026-10-21T19:00:00-05:00", title: "Men's Hockey vs Wisconsin-Stevens Point", detail: "Exhibition",
    times: "7:00 PM – 10:30 PM", area: "Video", person: { name: "Dev Patel" }, summary: "Dev Patel wants Maya Brandt's shift",
    note: "Class conflict, sorry!", notices: [{ tone: "info", text: "Auto-approval check by Oct 21, 5:00 PM if nobody reviews it." }],
    status: { label: "Needs review", variant: "orange" },
    actions: [act("Approve", "Approving…", "primary"), act("Decline", "Declining…", "outline")],
  },
  {
    key: "r2", startsAt: "2026-10-23T11:00:00-05:00", title: "Volleyball vs Iowa", detail: null,
    times: "11:00 AM – 3:00 PM", area: "Photo", person: { name: "Lena Fox" }, summary: "Lena Fox wants this open slot",
    note: null, notices: [{ tone: "warn", text: "Overlaps a class block (10:00 AM – 11:15 AM)." }],
    status: { label: "Needs review", variant: "orange" },
    actions: [act("Approve", "Approving…", "primary"), act("Decline", "Declining…", "outline")],
  },
];

const history: BoardRow[] = [
  {
    key: "h1", startsAt: "2026-10-18T13:00:00-05:00", title: "Football vs Penn State", detail: null,
    times: "1:00 PM – 8:00 PM", area: "Photo", person: { name: "Maya Brandt" }, summary: "Maya Brandt → Jordan Ellis",
    note: null, notices: [], status: { label: "Completed", variant: "gray" }, muted: true, actions: [],
  },
];

export default function TradeBoardLab() {
  const [admin, setAdmin] = useState(false);
  const [emptyAll, setEmptyAll] = useState(false);
  const [tab, setTab] = useState<BoardTab>("available");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isAdmin = params.get("role") === "admin";
    setAdmin(isAdmin);
    setEmptyAll(params.get("empty") === "1");
    if (isAdmin) setTab("review");
  }, []);
  const tabs: BoardTabSpec[] = [
    ...(admin ? [{ id: "review" as const, label: "Review", count: review.length, rows: review }] : []),
    { id: "available", label: "Available", count: available.length, rows: available },
    { id: "mine", label: "Mine", count: mine.length, rows: mine },
    { id: "history", label: "History", count: 0, rows: history },
  ];
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <TradeBoardView
        now={NOW}
        tabs={emptyAll ? tabs.map((t) => ({ ...t, rows: [], count: 0 })) : tabs}
        tab={tab}
        onTab={setTab}
        loading={false}
        errors={[]}
        needsReview={null}
        intro={admin ? null : "Claim open shifts and trades in your area. An admin approves every change before it reaches the schedule."}
        toolbar={<span className="text-xs text-muted-foreground">Area: all</span>}
      />
    </div>
  );
}
