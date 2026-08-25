"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Eraser, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SignatureAthleteProfileForm, type SignatureAthleteProfileValues } from "@/components/signatures/SignatureAthleteProfileForm";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { invalidateSignatureCollectionCaches } from "@/lib/signatures/client-cache";
import {
  appendDistinctSignaturePoints,
  isCurrentDeviceIpad,
  signatureCanvasViewport,
  signaturePointFromClient,
  shouldRetainSignatureSaveRequestId,
  type SignatureCanvasSize,
} from "@/lib/signatures/capture";
import { buildSignatureCurve } from "@/lib/signatures/geometry";
import { acceptsSignaturePointer, appendCoalescedPointerEvents } from "@/lib/signatures/pointer";
import { buildSignatureDraft, deleteSignatureDraftsForMember, loadSignatureDraft, saveSignatureDraft, signatureDraftKey, type SignatureDraftStroke } from "@/lib/signatures/drafts";
import { signatureSaveRequestIdSchema } from "@/lib/signatures/types";

type PenSettings = { strokeColor: string; strokeWidth: number; cropPadding: number; maxWidth: number; maxHeight: number };
type AthleteProfile = SignatureAthleteProfileValues;
type Member = { id: string; name: string; jerseyNumber: number | null; title: string | null; roleGroup: string; active: boolean; captureVersion: number; settingsVersion: number; captureSettings?: PenSettings; artifact: { id: string } | null; athleteProfile: AthleteProfile | null; athleteProfileComplete: boolean };
type Collection = { id: string; season: string; status: "OPEN" | "ARCHIVED"; collectionVersion: number; member: Member };
type DraftStatus = "loading" | "empty" | "saving" | "saved" | "unavailable";

function pointForEvent(event: PointerEvent, canvas: HTMLCanvasElement, logicalSize: SignatureCanvasSize) {
  const rect = canvas.getBoundingClientRect();
  return signaturePointFromClient(event.clientX, event.clientY, rect, logicalSize);
}

function drawStrokes(
  canvas: HTMLCanvasElement,
  strokes: SignatureDraftStroke[],
  color: string,
  strokeWidth: number,
  logicalSize: SignatureCanvasSize,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d");
  if (!context) return;
  const backingWidth = Math.max(1, Math.floor(rect.width * dpr));
  const backingHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const viewport = signatureCanvasViewport(rect, logicalSize);
  context.setTransform(
    dpr * viewport.scale,
    0,
    0,
    dpr * viewport.scale,
    dpr * viewport.offsetX,
    dpr * viewport.offsetY,
  );
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, logicalSize.width, logicalSize.height);
  context.strokeStyle = color;
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const curve = buildSignatureCurve(stroke.points);
    context.beginPath();
    context.moveTo(curve.start.x, curve.start.y);
    for (const segment of curve.segments) {
      if (segment.type === "L") {
        context.lineTo(segment.to.x, segment.to.y);
      } else {
        context.quadraticCurveTo(segment.control.x, segment.control.y, segment.to.x, segment.to.y);
      }
    }
    context.stroke();
  }
}

export default function SignatureCapturePage({ collectionId, memberId, userId }: { collectionId: string; memberId: string; userId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isIpad, setIsIpad] = useState<boolean | null>(null);
  const { data: collection, loading, error, reload, refreshing } = useFetch<Collection>({
    url: `/api/signatures/collections/${collectionId}/members/${memberId}`,
    enabled: isIpad === true,
  });
  const member = collection?.member ?? null;
  const settings = member?.captureSettings;
  const draftKey = useMemo(
    () => collection && member
      ? signatureDraftKey(userId, collection.id, member.id, member.settingsVersion, member.captureVersion)
      : null,
    [collection, member, userId],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logicalCanvasSizeRef = useRef<SignatureCanvasSize | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const draftQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftRevisionRef = useRef(0);
  const saveRequestIdRef = useRef<string | null>(null);
  const strokesRef = useRef<SignatureDraftStroke[]>([]);
  const [strokes, setStrokes] = useState<SignatureDraftStroke[]>([]);
  const [redoStack, setRedoStack] = useState<SignatureDraftStroke[]>([]);
  const [clearedStrokes, setClearedStrokes] = useState<SignatureDraftStroke[] | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("loading");
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileStep, setProfileStep] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [message, setMessage] = useState("Checking this iPad for a saved draft…");

  useEffect(() => {
    setIsIpad(isCurrentDeviceIpad());
  }, []);

  const ensureLogicalCanvasSize = useCallback((canvas: HTMLCanvasElement): SignatureCanvasSize => {
    const current = logicalCanvasSizeRef.current;
    if (current) return current;
    const rect = canvas.getBoundingClientRect();
    const next = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
    logicalCanvasSizeRef.current = next;
    return next;
  }, []);

  const drawCurrentStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !settings) return;
    drawStrokes(
      canvas,
      strokesRef.current,
      settings.strokeColor,
      settings.strokeWidth,
      ensureLogicalCanvasSize(canvas),
    );
  }, [ensureLogicalCanvasSize, settings]);

  const scheduleCanvasDraw = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      drawCurrentStrokes();
    });
  }, [drawCurrentStrokes]);

  const persistDraftSnapshot = useCallback((snapshot: SignatureDraftStroke[], revision: number, saveRequestId: string | null = saveRequestIdRef.current) => {
    if (!draftKey || !draftLoaded || !member) return Promise.resolve();
    const canvas = canvasRef.current;
    const canvasSize = logicalCanvasSizeRef.current ?? (canvas ? ensureLogicalCanvasSize(canvas) : null);
    if (!canvasSize) return Promise.resolve();

    setDraftStatus("saving");
    const operation = draftQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (snapshot.length === 0) {
          await deleteSignatureDraftsForMember({
            userId,
            collectionId,
            memberId,
            settingsVersion: member.settingsVersion,
          });
          return;
        }
        await saveSignatureDraft(buildSignatureDraft({
          key: draftKey,
          userId,
          collectionId,
          memberId,
          settingsVersion: member.settingsVersion,
          captureVersion: member.captureVersion,
          ...(saveRequestId ? { saveRequestId } : {}),
          canvasSize,
          strokes: snapshot,
        }));
      });
    draftQueueRef.current = operation;
    operation.then(
      () => {
        if (draftRevisionRef.current === revision) {
          setDraftStatus(snapshot.length === 0 ? "empty" : "saved");
        }
      },
      () => {
        if (draftRevisionRef.current === revision) setDraftStatus("unavailable");
      },
    );
    return operation;
  }, [collectionId, draftKey, draftLoaded, ensureLogicalCanvasSize, member, memberId, userId]);

  const commitStrokes = useCallback((next: SignatureDraftStroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    saveRequestIdRef.current = null;
    draftRevisionRef.current += 1;
    scheduleCanvasDraw();
    return draftRevisionRef.current;
  }, [scheduleCanvasDraw]);

  const commitAndPersistStrokes = useCallback((next: SignatureDraftStroke[]) => {
    const revision = commitStrokes(next);
    void persistDraftSnapshot(next, revision);
  }, [commitStrokes, persistDraftSnapshot]);

  useEffect(() => {
    if (!canvasRef.current || !settings) return;
    const canvas = canvasRef.current;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (
        strokesRef.current.length === 0 &&
        activePointerRef.current === null &&
        !clearedStrokes &&
        redoStack.length === 0 &&
        draftLoaded
      ) {
        logicalCanvasSizeRef.current = {
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
        };
      } else {
        ensureLogicalCanvasSize(canvas);
      }
      drawCurrentStrokes();
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, [clearedStrokes, draftLoaded, drawCurrentStrokes, ensureLogicalCanvasSize, redoStack.length, settings]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!draftKey) return;
    setDraftLoaded(false);
    setDraftStatus("loading");
    setMessage("Checking this iPad for a saved draft…");
    let cancelled = false;
    loadSignatureDraft(draftKey, Date.now(), {
      userId,
      collectionId,
      memberId,
      settingsVersion: member?.settingsVersion ?? 1,
    }).then((draft) => {
      if (cancelled) return;
      if (draft) {
        logicalCanvasSizeRef.current = draft.canvasSize;
        strokesRef.current = draft.strokes;
        setStrokes(draft.strokes);
        setDraftStatus("saved");
        setMessage(draft.captureVersion === member?.captureVersion
          ? "Recovered a saved draft from this iPad"
          : "Recovered a draft from before another iPad saved this signer — review it before saving");
      } else {
        strokesRef.current = [];
        setStrokes([]);
        setDraftStatus("empty");
        setMessage("Use Apple Pencil or compatible pen input to sign");
      }
      draftRevisionRef.current = 0;
      saveRequestIdRef.current = draft && draft.captureVersion === member?.captureVersion
        && draft.saveRequestId
        && signatureSaveRequestIdSchema.safeParse(draft.saveRequestId).success
        ? draft.saveRequestId
        : null;
      setDraftLoaded(true);
      scheduleCanvasDraw();
    }).catch(() => {
      if (cancelled) return;
      setDraftStatus("unavailable");
      setMessage("Local recovery is unavailable — keep this page open until the signature is saved");
      setDraftLoaded(true);
    });
    return () => { cancelled = true; };
  }, [collectionId, draftKey, member?.captureVersion, member?.settingsVersion, memberId, scheduleCanvasDraw, userId]);

  const appendPointerSamples = useCallback((event: PointerEvent, canvas: HTMLCanvasElement) => {
    const logicalSize = ensureLogicalCanvasSize(canvas);
    const points = appendCoalescedPointerEvents(event)
      .map((sample) => pointForEvent(sample, canvas, logicalSize))
      .filter((point): point is NonNullable<typeof point> => point !== null);
    const current = strokesRef.current;
    const lastStroke = current.at(-1);
    if (!lastStroke || points.length === 0) return current;
    const nextPoints = appendDistinctSignaturePoints(lastStroke.points, points);
    if (nextPoints === lastStroke.points) return current;
    const next = current.slice();
    next[next.length - 1] = { points: nextPoints };
    strokesRef.current = next;
    scheduleCanvasDraw();
    return next;
  }, [ensureLogicalCanvasSize, scheduleCanvasDraw]);

  const finalizeInterruptedStroke = useCallback((nextMessage: string) => {
    if (activePointerRef.current === null) return;
    activePointerRef.current = null;
    setDrawing(false);
    commitAndPersistStrokes(strokesRef.current);
    setMessage(nextMessage);
  }, [commitAndPersistStrokes]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        finalizeInterruptedStroke("Pencil input was interrupted; the partial stroke was kept");
      }
    };
    const onPageHide = () => {
      finalizeInterruptedStroke("Pencil input was interrupted; the partial stroke was kept");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [finalizeInterruptedStroke]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (saving) {
      setMessage("Wait for the current signature save to finish");
      return;
    }
    if (!draftLoaded) {
      setMessage("Wait while this iPad checks for a saved draft");
      return;
    }
    if (!acceptsSignaturePointer(event.pointerType)) {
      setMessage("Touch and mouse do not draw here — use Apple Pencil or compatible pen input");
      return;
    }
    if (activePointerRef.current !== null) return;
    if (strokesRef.current.length === 0 && (clearedStrokes || redoStack.length > 0)) {
      const rect = event.currentTarget.getBoundingClientRect();
      logicalCanvasSizeRef.current = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      setClearedStrokes(null);
      setRedoStack([]);
    }
    const logicalSize = ensureLogicalCanvasSize(event.currentTarget);
    const point = pointForEvent(event.nativeEvent, event.currentTarget, logicalSize);
    if (!point) {
      setMessage("Draw inside the white signature area");
      return;
    }

    event.preventDefault();
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokesRef.current = [...strokesRef.current, { points: [point] }];
    saveRequestIdRef.current = null;
    setDrawing(true);
    setRedoStack([]);
    setClearedStrokes(null);
    setDraftStatus("saving");
    setMessage("Drawing with pen input");
    scheduleCanvasDraw();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId || !acceptsSignaturePointer(event.pointerType)) return;
    event.preventDefault();
    appendPointerSamples(event.nativeEvent, event.currentTarget);
  }

  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>, includeTerminalSamples: boolean, nextMessage?: string) {
    if (activePointerRef.current !== event.pointerId) return;
    if (includeTerminalSamples) appendPointerSamples(event.nativeEvent, event.currentTarget);
    activePointerRef.current = null;
    setDrawing(false);
    commitAndPersistStrokes(strokesRef.current);
    if (nextMessage) setMessage(nextMessage);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer may already be released */ }
  }

  function undo() {
    if (drawing || saving) return;
    const current = strokesRef.current;
    if (current.length === 0 && clearedStrokes) {
      setClearedStrokes(null);
      setRedoStack([]);
      commitAndPersistStrokes(clearedStrokes);
      setMessage("Cleared signature restored");
      return;
    }
    if (current.length === 0) return;
    const next = current.slice();
    const removed = next.pop()!;
    setRedoStack((redo) => [...redo, removed]);
    setClearedStrokes(null);
    commitAndPersistStrokes(next);
    setMessage("Last stroke removed");
  }

  function redo() {
    if (drawing || saving) return;
    const restored = redoStack.at(-1);
    if (!restored) return;
    setRedoStack((current) => current.slice(0, -1));
    setClearedStrokes(null);
    commitAndPersistStrokes([...strokesRef.current, restored]);
    setMessage("Stroke restored");
  }

  function reset() {
    if (drawing || saving || strokesRef.current.length === 0) return;
    setClearedStrokes(strokesRef.current);
    setRedoStack([]);
    commitAndPersistStrokes([]);
    setMessage("Canvas cleared — Undo restores the signature");
  }

  async function save() {
    const snapshot = strokesRef.current;
    if (!collection || !member || snapshot.length === 0 || saving || drawing) return;
    const requestId = saveRequestIdRef.current ?? crypto.randomUUID();
    saveRequestIdRef.current = requestId;
    setSaving(true);
    setMessage("Saving both private signature files…");
    try {
      await persistDraftSnapshot(snapshot, draftRevisionRef.current, requestId).catch(() => undefined);
      const response = await fetch(`/api/signatures/collections/${collection.id}/capture/${member.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          expectedCaptureVersion: member.captureVersion,
          settingsVersion: member.settingsVersion,
          strokes: snapshot,
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        if (!shouldRetainSignatureSaveRequestId(response.status)) {
          saveRequestIdRef.current = null;
          await persistDraftSnapshot(snapshot, draftRevisionRef.current, null).catch(() => undefined);
        }
        throw new Error(await parseErrorMessage(response, "Signature was not saved"));
      }
      if (draftKey) {
        const deletion = draftQueueRef.current
          .catch(() => undefined)
          .then(() => deleteSignatureDraftsForMember({
            userId,
            collectionId,
            memberId,
            settingsVersion: member.settingsVersion,
          }));
        draftQueueRef.current = deletion;
        await deletion.catch(() => undefined);
      }
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      toast.success(`${member.name}'s signature saved`);
      if (member.roleGroup === "PLAYER") {
        setProfileStep(true);
        setMessage("Signature saved. Add this athlete’s website profile details.");
      } else {
        router.push(`/signatures/${collection.id}`);
      }
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Signature was not saved");
    } finally {
      setSaving(false);
    }
  }

  async function saveAthleteProfile(values: { birthday: string; hometown: string; instagramHandle: string; tiktokHandle: string; xHandle: string }) {
    if (!collection || !member || member.roleGroup !== "PLAYER") return;
    setProfileSaving(true);
    setMessage("Saving website profile…");
    try {
      const response = await fetch(`/api/signatures/collections/${collection.id}/members/${member.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCollectionVersion: collection.collectionVersion, ...values }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Athlete profile was not saved"));
      await invalidateSignatureCollectionCaches(queryClient, collection.id);
      toast.success(`${member.name}'s website profile saved`);
      router.push(`/signatures/${collection.id}`);
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Athlete profile was not saved");
    } finally {
      setProfileSaving(false);
    }
  }

  const draftLabel = drawing
    ? "Drawing…"
    : {
        loading: "Checking draft…",
        empty: "Blank",
        saving: "Saving draft…",
        saved: "Saved on iPad",
        unavailable: "Recovery unavailable",
      }[draftStatus];

  if (isIpad === null || loading) return <div className="flex min-h-[100dvh] items-center justify-center text-sm text-muted-foreground">Checking this iPad…</div>;
  if (!isIpad) return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <Card className="max-w-md p-6">
        <p className="font-semibold">Capture on iPad</p>
        <p className="mt-2 text-sm text-muted-foreground">Capture can only be done on an iPad with an Apple Pencil.</p>
        <Button variant="outline" className="mt-5 h-11" asChild><Link href={`/signatures/${collectionId}`}><ArrowLeft data-icon="inline-start" />Return to roster</Link></Button>
      </Card>
    </div>
  );
  if (error) return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <Card className="max-w-md p-6">
        <p className="font-semibold">Couldn’t load this signer</p>
        <p className="mt-2 text-sm text-muted-foreground">The roster could not be reached. Try again before starting capture.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="brand" className="h-11" onClick={reload} disabled={refreshing}>Retry</Button>
          <Button variant="outline" className="h-11" asChild><Link href={`/signatures/${collectionId}`}><ArrowLeft data-icon="inline-start" />Return to roster</Link></Button>
        </div>
      </Card>
    </div>
  );
  if (!collection || !member || !member.active || !settings || collection.status !== "OPEN") {
    // These four states are reached with a loaded payload, so the surface can
    // name the one that actually blocked capture instead of listing guesses.
    const unavailable = !collection || !member
      ? {
          title: "This signer is unavailable",
          description: "The capture surface could not resolve this signer. Open them again from the roster.",
        }
      : collection.status !== "OPEN"
        ? {
            title: `The ${collection.season} collection is archived`,
            description: "Archived collections are read-only. An admin has to restore this collection before any new signature can be captured.",
          }
        : !member.active
          ? {
              title: `${member.name} is not active on this roster`,
              description: "Inactive signers cannot be captured. Any signature already saved for them is retained and still downloadable from the roster.",
            }
          : {
              title: "Capture settings are unavailable",
              description: "This collection did not return usable pen settings, so capture cannot start. Check the collection's capture settings.",
            };

    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6">
        <Card className="max-w-md p-6">
          <p className="font-semibold">{unavailable.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{unavailable.description}</p>
          <Button variant="outline" className="mt-5 h-11" asChild><Link href={`/signatures/${collectionId}`}><ArrowLeft data-icon="inline-start" />Return to roster</Link></Button>
        </Card>
      </div>
    );
  }

  return (
    <main
      className="min-h-[100dvh] bg-background px-3 py-3 sm:px-5 sm:py-5"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
      }}
    >
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-6xl flex-col gap-3 sm:min-h-[calc(100dvh-2.5rem)]">
        <header className="flex shrink-0 items-center justify-between gap-3 rounded-xl border bg-card px-3 py-3 shadow-sm sm:px-5">
          {saving ? (
            <Button variant="ghost" size="sm" className="h-11" disabled><ArrowLeft data-icon="inline-start" />Roster</Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-11" asChild><Link href={`/signatures/${collection.id}`}><ArrowLeft data-icon="inline-start" />Roster</Link></Button>
          )}
          <div className="min-w-0 text-center"><h1 className="truncate text-lg! font-semibold!">{member.name}</h1><p className="text-xs text-muted-foreground">{member.jerseyNumber !== null ? `#${member.jerseyNumber} · ` : ""}{member.title || member.roleGroup.replaceAll("_", " ")} · {collection.season}</p></div>
          <div className="w-[104px] text-right text-xs text-muted-foreground" aria-live="polite">{profileStep ? "Profile details" : draftLabel}</div>
        </header>
        {profileStep ? (
          <section className="flex min-h-0 flex-1 flex-col justify-center rounded-xl border bg-card p-4 shadow-sm sm:p-8" aria-label={`Website profile for ${member.name}`}>
            <div className="mx-auto w-full max-w-3xl">
              <SignatureAthleteProfileForm
                initialValues={member.athleteProfile ?? { birthday: null, hometown: null, instagramHandle: null, tiktokHandle: null, xHandle: null }}
                busy={profileSaving}
                onSubmit={saveAthleteProfile}
                onCancel={() => router.push(`/signatures/${collection.id}`)}
              />
              <p role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">{message}</p>
            </div>
          </section>
        ) : (
        <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:p-5" aria-label={`Signature canvas for ${member.name}`}>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p id="signature-capture-status" role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Undo stroke" onClick={undo} disabled={saving || drawing || (strokes.length === 0 && !clearedStrokes)}><Undo2 /></Button>
              <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Redo stroke" onClick={redo} disabled={saving || drawing || redoStack.length === 0}><Redo2 /></Button>
              <Button type="button" variant="outline" size="sm" className="h-11" onClick={reset} disabled={saving || drawing || strokes.length === 0}><Eraser data-icon="inline-start" />Clear</Button>
            </div>
          </div>
          <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/40">
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 size-full touch-none ${draftLoaded && !saving ? "" : "pointer-events-none opacity-70"}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointer(event, true, "Stroke captured")}
              onPointerCancel={(event) => finishPointer(event, false, "Pencil input was interrupted; the partial stroke was kept")}
              onLostPointerCapture={(event) => {
                if (activePointerRef.current === event.pointerId) {
                  finalizeInterruptedStroke("Pencil input was interrupted; the partial stroke was kept");
                }
              }}
              aria-label="Pen-input signature canvas"
              aria-describedby="signature-capture-status"
              aria-disabled={!draftLoaded}
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Use Apple Pencil or compatible pen input to draw. Touch is reserved for controls.</p>
            <div className="flex gap-2">
              {saving ? (
                <Button variant="outline" className="h-11" disabled>Cancel</Button>
              ) : (
                <Button variant="outline" className="h-11" asChild><Link href={`/signatures/${collection.id}`}>Cancel</Link></Button>
              )}
              <Button className="h-11 min-w-36" onClick={save} loading={saving} disabled={saving || drawing || strokes.length === 0}>
                {!saving && <Check data-icon="inline-start" />}
                Save signature
              </Button>
            </div>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
