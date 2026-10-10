"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { APPLICATION_STAGES, STAGE_LABELS, STANDING_LABELS, TERM_LABELS, isHttpsUrl } from "@/lib/hiring/contract";
import type { ApplicationStage } from "@prisma/client";
import { PickAccountDialog, type AccountChoice } from "./HiringDialogs";
import { AREA_LABEL, messageOf, type ApplicationDetail } from "./types";

type Props = {
  applicationId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onStageChange: (id: string, stage: ApplicationStage) => Promise<void>;
  /** Ids in the current filtered board order, for J/K review navigation. */
  queue: string[];
  onNavigate: (id: string) => void;
};

function ExternalLinkRow({ label, href }: { label: string; href: string | null }) {
  if (!href || !isHttpsUrl(href)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2">
      {label} <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export default function ApplicationSheet({ applicationId, onClose, onChanged, onStageChange, queue, onNavigate }: Props) {
  const confirm = useConfirm();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteRating, setNoteRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [accountChoices, setAccountChoices] = useState<AccountChoice[] | null>(null);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The id the panel is showing now; a slower response for an earlier id must not replace it.
  const currentId = useRef<string | null>(null);
  currentId.current = applicationId;

  const load = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/hiring/applications/${id}`);
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: ApplicationDetail }>(res);
      if (currentId.current !== id) return;
      if (!res.ok || !json?.data) throw new Error(messageOf(json, "Could not load the applicant."));
      setDetail(json.data);
      setError(null);
      setActiveDoc((current) => current ?? json.data?.documents.find((d) => d.kind === "RESUME")?.id ?? json.data?.documents[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the applicant.");
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    setInviteEmail("");
    setAccountChoices(null);
    setActiveDoc(null);
    setNoteBody("");
    setNoteRating("");
    if (applicationId) void load(applicationId);
  }, [applicationId, load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    if (!applicationId) return false;
    const res = await fetch(`/api/hiring/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (handleAuthRedirect(res)) return false;
    if (!res.ok) {
      toast.error(await parseErrorMessage(res, "Could not save the change."));
      return false;
    }
    await load(applicationId);
    onChanged();
    return true;
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!applicationId || !noteBody.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/applications/${applicationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody, rating: noteRating ? Number(noteRating) : undefined }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not add the note."));
      setNoteBody("");
      setNoteRating("");
      await load(applicationId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the note.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File, kind: string) {
    if (!applicationId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      const res = await fetch(`/api/hiring/applications/${applicationId}/documents`, { method: "POST", body: form });
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: { id: string } }>(res);
      if (!res.ok) throw new Error(messageOf(json, "Could not upload the file."));
      setActiveDoc(json?.data?.id ?? null);
      await load(applicationId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload the file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeDocument(id: string) {
    if (!applicationId) return;
    const res = await fetch(`/api/hiring/documents/${id}`, { method: "DELETE" });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      toast.error(await parseErrorMessage(res, "Could not remove the file."));
      return;
    }
    setActiveDoc(null);
    await load(applicationId);
    onChanged();
  }

  type InviteOptions = { linkExistingUser?: boolean; linkUserId?: string; confirmNewAccount?: boolean };
  async function createInvite(options: InviteOptions = {}): Promise<void> {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/applications/${detail.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The admin chooses which known address to invite; the newest is the default.
        body: JSON.stringify({ ...options, email: inviteEmail || detail.applicant.emails[0]?.email }),
      });
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{
        error?: string;
        code?: string;
        data?: { user?: { name: string }; users?: AccountChoice[] };
      }>(res);
      if (res.status === 409 && json?.code === "user_exists" && !options.linkExistingUser) {
        const confirmed = await confirm({
          title: `Link to ${json.data?.user?.name ?? "the existing account"}?`,
          message: "An account already exists for this email. Link this applicant to it instead of sending an invite.",
          confirmLabel: "Link account",
        });
        if (confirmed) await createInvite({ linkExistingUser: true });
        return;
      }
      if (res.status === 409 && json?.code === "possible_account" && json.data?.users?.length) {
        // Show every candidate (with email and status) and let the admin choose.
        setAccountChoices(json.data.users);
        return;
      }
      if (!res.ok) throw new Error(messageOf(json, "Could not create the invite."));
      toast.success(options.linkExistingUser || options.linkUserId ? "Linked to the existing account" : "Student invite created");
      await load(detail.id);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }

  // Review-mode hotkeys. Inert while typing, while a modifier is held, and
  // while a confirmation dialog is open (D-065 brief section 14, item 10).
  useEffect(() => {
    if (!applicationId || !detail) return;
    const currentId = applicationId;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const index = queue.indexOf(currentId);
      const go = (offset: number) => {
        const next = queue[index + offset];
        if (next) onNavigate(next);
      };
      switch (event.key.toLowerCase()) {
        case "j":
          go(1);
          break;
        case "k":
          go(-1);
          break;
        case "r":
          void (async () => {
            // Move on only once Reviewed is actually saved, so a failed save cannot skip someone.
            const saved = detail!.reviewed ? true : await patch({ reviewed: true });
            if (saved) go(1);
          })();
          break;
        case "h":
          void onStageChange(currentId, "HIRE").then(() => load(currentId));
          break;
        case "p":
          void onStageChange(currentId, "PASSED").then(() => load(currentId));
          break;
        case "n":
          event.preventDefault();
          noteRef.current?.focus();
          break;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, detail, queue]);

  const activeDocument = detail?.documents.find((d) => d.id === activeDoc) ?? null;

  return (
    <Sheet open={applicationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{detail?.applicant.name ?? "Applicant"}</SheetTitle>
          <SheetDescription>{detail ? `${detail.cycle.label} application` : "Loading"}</SheetDescription>
        </SheetHeader>

        {error && (
          <p role="alert" className="px-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {!detail && !error && <Skeleton className="mx-4 h-64" />}

        {detail && (
          <div className="grid gap-5 px-4 pb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sheet-stage">Stage</Label>
                <NativeSelect
                  id="sheet-stage"
                  className="w-40"
                  value={detail.stage}
                  onChange={(e) => void onStageChange(detail.id, e.target.value as ApplicationStage).then(() => load(detail.id))}
                >
                  {APPLICATION_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button variant={detail.reviewed ? "secondary" : "outline"} onClick={() => void patch({ reviewed: !detail.reviewed })}>
                {detail.reviewed ? "Reviewed" : "Mark reviewed"}
              </Button>
              {detail.applicant.hiredUserId && <Badge variant="green">Linked to an account</Badge>}
            </div>

            <p className="text-xs text-muted-foreground">
              {detail.purgeOn
                ? `Personal data is deleted on ${new Date(detail.purgeOn).toLocaleDateString()}. The name stays.`
                : "Personal data is kept while a cycle is open or the person has an account."}
            </p>
            <p className="text-xs text-muted-foreground">Keys: J next, K previous, R reviewed and next, H hire, P pass, N note.</p>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{detail.applicant.emails.map((e) => e.email).join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{detail.applicant.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Standing</dt>
              <dd>{detail.applicant.standing ? STANDING_LABELS[detail.applicant.standing] : "—"}</dd>
              <dt className="text-muted-foreground">Graduates</dt>
              <dd>{detail.applicant.gradTerm && detail.applicant.gradYear ? `${TERM_LABELS[detail.applicant.gradTerm]} ${detail.applicant.gradYear}` : "—"}</dd>
              <dt className="text-muted-foreground">Areas</dt>
              <dd className="flex flex-wrap gap-1">
                {(detail.rawAreas.length ? detail.rawAreas : detail.primaryArea ? [AREA_LABEL[detail.primaryArea] ?? detail.primaryArea] : ["—"]).map((a) => (
                  <Badge key={a} variant="gray" size="sm">
                    {a}
                  </Badge>
                ))}
              </dd>
              <dt className="text-muted-foreground">Summer</dt>
              <dd>{detail.summerAvailable == null ? "—" : detail.summerAvailable ? "Available" : "Not available"}</dd>
              {detail.externalApplicationId && (
                <>
                  <dt className="text-muted-foreground">PageUp ID</dt>
                  <dd>{detail.externalApplicationId}</dd>
                </>
              )}
            </dl>

            {[
              ["Experience in", detail.fieldsExperience],
              ["Interested in", detail.fieldsInterested],
              ["Software", detail.softwareExperience],
            ].map(([label, items]) =>
              (items as string[]).length > 0 ? (
                <section key={label as string} aria-label={label as string} className="grid gap-1">
                  <h3 className="text-sm font-semibold">{label as string}</h3>
                  <ul className="flex flex-wrap gap-1">
                    {(items as string[]).map((item) => (
                      <li key={item}>
                        <Badge variant="gray" size="sm">
                          {item}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )}

            <div className="flex flex-wrap gap-4">
              <ExternalLinkRow label="Portfolio" href={detail.applicant.portfolioUrl} />
              {detail.sourceLinks?.map((link) => <ExternalLinkRow key={link.label} label={link.label} href={link.url} />)}
              <ExternalLinkRow label="Interview" href={detail.interviewUrl} />
            </div>

            {detail.applicant.history.length > 0 && (
              <section aria-label="Application history">
                <h3 className="mb-1 text-sm font-semibold">Seen before</h3>
                <ul className="flex flex-wrap gap-2">
                  {detail.applicant.history.map((h) => (
                    <li key={h.id}>
                      <Badge variant="blue">
                        {h.cycleLabel}: {STAGE_LABELS[h.stage]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail.stage === "HIRE" && (
              <section aria-label="Account" className="grid gap-2 rounded-md border p-3">
                <h3 className="text-sm font-semibold">Account</h3>
                {detail.applicant.hiredUserId ? (
                  <p className="text-sm text-muted-foreground">Linked to a student account.</p>
                ) : detail.invite ? (
                  <p className="text-sm text-muted-foreground">
                    Invite sent. It links automatically when they register.{" "}
                    <Link href="/users/onboarding-status" className="underline underline-offset-2">
                      Onboarding status
                    </Link>
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Creates a student invite from this applicant (name, area, email). Nothing is created until they register.
                    </p>
                    {detail.applicant.emails.length > 1 && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="invite-email">Invite this address</Label>
                        <NativeSelect id="invite-email" value={inviteEmail || detail.applicant.emails[0]?.email} onChange={(e) => setInviteEmail(e.target.value)}>
                          {detail.applicant.emails.map((e) => (
                            <option key={e.email} value={e.email}>
                              {e.email}
                            </option>
                          ))}
                        </NativeSelect>
                        <p className="text-xs text-muted-foreground">The newest address is selected. Choose another if that one is no longer in use.</p>
                      </div>
                    )}
                    <div>
                      <Button disabled={busy} onClick={() => void createInvite()}>
                        Create student invite
                      </Button>
                    </div>
                  </>
                )}
              </section>
            )}

            <section aria-label="Resume and files" className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Files</h3>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    id="applicant-file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file, detail.documents.some((d) => d.kind === "RESUME") ? "OTHER" : "RESUME");
                    }}
                  />
                  <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="size-4" aria-hidden /> Upload file
                  </Button>
                </div>
              </div>
              {detail.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{detail.sourceLinks?.length ? "Linked materials are available above. No files uploaded here yet." : "No files yet. PDF, PNG, or JPEG up to 4 MB."}</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {detail.documents.map((d) => (
                      <li key={d.id}>
                        <Button variant={d.id === activeDoc ? "secondary" : "outline"} onClick={() => setActiveDoc(d.id)}>
                          {d.kind === "RESUME" ? "Resume" : d.fileName}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {activeDocument && (
                    <div className="grid gap-2">
                      {activeDocument.contentType === "application/pdf" ? (
                        <iframe title={`${activeDocument.fileName} preview`} src={`/api/hiring/documents/${activeDocument.id}`} className="h-[28rem] w-full rounded-md border" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={activeDocument.fileName} src={`/api/hiring/documents/${activeDocument.id}`} className="max-h-[28rem] w-full rounded-md border object-contain" />
                      )}
                      <div className="flex gap-2">
                        <Button asChild variant="outline">
                          <a href={`/api/hiring/documents/${activeDocument.id}?download=1`}>
                            <Download className="size-4" aria-hidden /> Download
                          </a>
                        </Button>
                        <Button variant="outline" onClick={() => void removeDocument(activeDocument.id)}>
                          <Trash2 className="size-4" aria-hidden /> Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <section aria-label="Notes" className="grid gap-3">
              <h3 className="text-sm font-semibold">Notes</h3>
              <form onSubmit={addNote} className="grid gap-2">
                <Label htmlFor="note-body" className="sr-only">
                  Add a note
                </Label>
                <Textarea id="note-body" ref={noteRef} rows={3} placeholder="What stood out?" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                <div className="flex items-center justify-between gap-2">
                  <NativeSelect aria-label="Rating" className="w-32" value={noteRating} onChange={(e) => setNoteRating(e.target.value)}>
                    <option value="">No rating</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} of 5
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="submit" disabled={busy || !noteBody.trim()}>
                    Add note
                  </Button>
                </div>
              </form>
              <ul className="grid gap-3">
                {detail.notes.map((n) => (
                  <li key={n.id} className="rounded-md border p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.author?.name ?? "Former user"} · {new Date(n.createdAt).toLocaleDateString()}
                      {n.rating != null ? ` · ${n.rating} of 5` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
      <PickAccountDialog
        choices={accountChoices}
        applicantName={detail?.applicant.name ?? "This applicant"}
        onCancel={() => setAccountChoices(null)}
        onLink={(userId) => {
          setAccountChoices(null);
          void createInvite({ linkUserId: userId });
        }}
        onCreateNew={() => {
          setAccountChoices(null);
          void createInvite({ confirmNewAccount: true });
        }}
      />
    </Sheet>
  );
}
