"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";

const PREVIEW_SIZE = 640;
const OUTPUT_SIZE = 512;
const APERTURE_SIZE = PREVIEW_SIZE * 0.875;
type Crop = { zoom: number; offsetX: number; offsetY: number };
type Point = { x: number; y: number };
const centeredCrop: Crop = { zoom: 1, offsetX: 0, offsetY: 0 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawCrop(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  zoom: number,
  offsetX: number,
  offsetY: number,
  size: number,
  aperture = size,
) {
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo preview is unavailable in this browser");

  const baseScale = Math.max(aperture / image.naturalWidth, aperture / image.naturalHeight);
  const scale = baseScale * zoom;
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const maxX = Math.max(0, (renderedWidth - aperture) / 2);
  const maxY = Math.max(0, (renderedHeight - aperture) / 2);
  const x = (size - renderedWidth) / 2 + (offsetX / 100) * maxX;
  const y = (size - renderedHeight) / 2 + (offsetY / 100) * maxY;

  context.fillStyle = "#141414";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, renderedWidth, renderedHeight);
}

// Preserve the image under the fingers/cursor while zooming, then constrain the
// image to cover the circular aperture. Coordinates are preview-canvas pixels.
function transformCrop(image: HTMLImageElement, origin: Crop, nextZoom: number, from: Point, to = from): Crop {
  const zoom = clamp(nextZoom, 1, 3);
  const base = Math.max(APERTURE_SIZE / image.naturalWidth, APERTURE_SIZE / image.naturalHeight);
  const extent = (dimension: number, scale: number) => Math.max(0, (dimension * base * scale - APERTURE_SIZE) / 2);
  const ratio = zoom / origin.zoom;
  const axis = (dimension: number, offset: number, start: number, end: number) => {
    const limit = extent(dimension, zoom);
    const position = end - (start - offset / 100 * extent(dimension, origin.zoom)) * ratio;
    return limit > 0 ? clamp(position / limit * 100, -100, 100) : 0;
  };
  return { zoom, offsetX: axis(image.naturalWidth, origin.offsetX, from.x, to.x), offsetY: axis(image.naturalHeight, origin.offsetY, from.y, to.y) };
}

function midpoint(points: Point[]): Point {
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}
function distance(points: Point[]) { return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y); }

async function croppedAvatarFile(
  source: File,
  image: HTMLImageElement,
  zoom: number,
  offsetX: number,
  offsetY: number,
) {
  const canvas = document.createElement("canvas");
  drawCrop(canvas, image, zoom, offsetX, offsetY, OUTPUT_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("The cropped photo could not be created");
  const name = source.name.replace(/\.[^.]+$/, "") || "avatar";
  const type = blob.type === "image/webp" ? "image/webp" : "image/png";
  return new File([blob], `${name}.${type === "image/webp" ? "webp" : "png"}`, { type });
}

export function AvatarCropDialog({
  file,
  profileName,
  avatarUrl,
  onClose,
  onConfirm,
}: {
  file: File | null;
  profileName: string;
  avatarUrl: string | null;
  onClose: () => void;
  onConfirm: (file: File, expectedAvatarUrl: string | null, expectedActorId: string | null) => Promise<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ crop: Crop; points: Point[] } | null>(null);
  const cropRef = useRef(centeredCrop);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState(centeredCrop);
  const { zoom, offsetX, offsetY } = crop;
  const [processing, setProcessing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const currentAvatar = useRef(avatarUrl);
  currentAvatar.current = avatarUrl;
  const expectedAvatar = useRef<string | null>(null);
  const actorId = useAuthenticatedQueryUserId();
  const currentActor = useRef(actorId); currentActor.current = actorId;
  const expectedActor = useRef<string | null>(null);

  const updateCrop = useCallback((next: Crop) => { cropRef.current = next; setCrop(next); }, []);

  useEffect(() => {
    if (!file) {
      setImage(null);
      return;
    }
    updateCrop(centeredCrop);
    pointers.current.clear(); gesture.current = null;
    expectedAvatar.current = currentAvatar.current;
    expectedActor.current = currentActor.current;
    setLoadError("");
    setActionError("");
    setImage(null);
    if (file.size > 20 * 1024 * 1024) {
      setLoadError("Choose a photo under 20 MB. We’ll resize it before uploading.");
      return;
    }
    let active = true;
    const objectUrl = URL.createObjectURL(file);
    const nextImage = new window.Image();
    nextImage.onload = () => {
      if (!active) return;
      if (nextImage.naturalWidth * nextImage.naturalHeight > 40_000_000) {
        setLoadError("This photo is too large to crop here. Choose a smaller image or use the iPhone app.");
      } else { setImage(nextImage); }
    };
    nextImage.onerror = () => { if (active) setLoadError("This photo could not be opened. Choose a JPEG, PNG, or WebP image, or select it in the iPhone app."); };
    nextImage.src = objectUrl;
    return () => { active = false; URL.revokeObjectURL(objectUrl); };
  }, [file, updateCrop]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    try { drawCrop(canvasRef.current, image, zoom, offsetX, offsetY, PREVIEW_SIZE, APERTURE_SIZE); }
    catch { setLoadError("Photo preview is unavailable. Try another browser or the iPhone app."); }
  }, [image, offsetX, offsetY, zoom]);

  function resetCrop() { updateCrop(centeredCrop); rebaseGesture(); }

  function rebaseGesture() {
    gesture.current = pointers.current.size ? { crop: cropRef.current, points: [...pointers.current.values()].slice(0, 2) } : null;
  }

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left - bounds.width / 2) / bounds.width * PREVIEW_SIZE, y: (event.clientY - bounds.top - bounds.height / 2) / bounds.height * PREVIEW_SIZE };
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (processing || !image || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, pointerPosition(event));
    rebaseGesture();
  }

  function moveCrop(event: PointerEvent<HTMLCanvasElement>) {
    if (!gesture.current || !image || processing || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, pointerPosition(event));
    const current = [...pointers.current.values()].slice(0, 2);
    const origin = gesture.current;
    const scale = current.length === 2 && origin.points.length === 2 ? distance(current) / Math.max(distance(origin.points), 1) : 1;
    updateCrop(transformCrop(image, origin.crop, origin.crop.zoom * scale, midpoint(origin.points), midpoint(current)));
  }

  function endGesture(event: PointerEvent<HTMLCanvasElement>) { pointers.current.delete(event.pointerId); rebaseGesture(); }

  function zoomBy(factor: number) {
    if (image && !processing) updateCrop(transformCrop(image, cropRef.current, cropRef.current.zoom * factor, { x: 0, y: 0 }));
  }

  function keyboardCrop(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!image || processing) return;
    const delta = event.shiftKey ? 40 : 10;
    const moves: Record<string, Point> = { ArrowLeft: { x: -delta, y: 0 }, ArrowRight: { x: delta, y: 0 }, ArrowUp: { x: 0, y: -delta }, ArrowDown: { x: 0, y: delta } };
    if (moves[event.key]) updateCrop(transformCrop(image, cropRef.current, cropRef.current.zoom, { x: 0, y: 0 }, moves[event.key]));
    else if (event.key === "+" || event.key === "=") zoomBy(1.15);
    else if (event.key === "-") zoomBy(1 / 1.15);
    else if (event.key === "Home") resetCrop();
    else return;
    event.preventDefault();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || processing) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const bounds = canvas!.getBoundingClientRect();
      const focal = { x: (event.clientX - bounds.left - bounds.width / 2) / bounds.width * PREVIEW_SIZE, y: (event.clientY - bounds.top - bounds.height / 2) / bounds.height * PREVIEW_SIZE };
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      updateCrop(transformCrop(image!, cropRef.current, cropRef.current.zoom * Math.exp(-pixels * (event.ctrlKey ? 0.01 : 0.002)), focal));
      gesture.current = null; pointers.current.clear();
    }
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [image, processing, updateCrop]);

  async function confirmCrop() {
    if (!file || !image || processing) return;
    setProcessing(true);
    setActionError("");
    try {
      const cropped = await croppedAvatarFile(file, image, zoom, offsetX, offsetY);
      const saved = await onConfirm(cropped, expectedAvatar.current, expectedActor.current);
      if (saved) onClose();
      else setActionError("Your photo wasn’t saved. Check your connection and try again. Your crop is still here.");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The cropped photo could not be created");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => { if (!open && !processing) onClose(); }}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-w-lg">
        <DialogHeader className="flex-col items-start gap-1 pr-14">
          <DialogTitle>Crop profile photo</DialogTitle>
          <DialogDescription>
            Drag to move. Pinch or scroll to zoom.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-col gap-5 py-5">
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
          ) : (
            <div className="relative mx-auto aspect-square w-full max-w-96 overflow-hidden rounded-lg bg-neutral-900">
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`${profileName}’s profile photo crop preview`}
                aria-describedby="photo-crop-keyboard-help"
                tabIndex={image && !processing ? 0 : -1}
                className="size-full touch-none cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
                onPointerDown={startDrag}
                onPointerMove={moveCrop}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onLostPointerCapture={endGesture}
                onKeyDown={keyboardCrop}
              />
              <div aria-hidden className="pointer-events-none absolute inset-[6.25%] rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgb(0_0_0/0.55)]" />
              {!image && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Spinner className="text-white" /></div>}
            </div>
          )}

          <p id="photo-crop-keyboard-help" className="sr-only">Use arrow keys to move the photo, plus and minus to zoom, or Home to reset.</p>
          <div role="group" aria-label="Photo controls" className="flex items-center justify-center gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={() => zoomBy(1 / 1.15)} disabled={!image || processing || zoom <= 1} aria-label="Zoom out"><Minus /></Button>
            <Button type="button" variant="ghost" className="h-10" onClick={resetCrop} disabled={!image || processing || (zoom === 1 && offsetX === 0 && offsetY === 0)}><RotateCcw data-icon="inline-start" /> Reset</Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => zoomBy(1.15)} disabled={!image || processing || zoom >= 3} aria-label="Zoom in"><Plus /></Button>
          </div>
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={processing}>Cancel</Button>
          <Button type="button" onClick={confirmCrop} disabled={!image || Boolean(loadError) || processing}>
            {processing && <Spinner data-icon="inline-start" />}
            Save photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
