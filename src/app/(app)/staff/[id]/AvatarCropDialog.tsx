"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Move, RotateCcw, ZoomIn } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const PREVIEW_SIZE = 640;
const OUTPUT_SIZE = 512;

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
) {
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo preview is unavailable in this browser");

  const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const scale = baseScale * zoom;
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const maxX = Math.max(0, (renderedWidth - size) / 2);
  const maxY = Math.max(0, (renderedHeight - size) / 2);
  const x = (size - renderedWidth) / 2 + (offsetX / 100) * maxX;
  const y = (size - renderedHeight) / 2 + (offsetY / 100) * maxY;

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, renderedWidth, renderedHeight);
}

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
  return new File([blob], `${name}.webp`, { type: "image/webp" });
}

export function AvatarCropDialog({
  file,
  profileName,
  onClose,
  onConfirm,
}: {
  file: File | null;
  profileName: string;
  onClose: () => void;
  onConfirm: (file: File) => Promise<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!file) {
      setImage(null);
      return;
    }
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setLoadError("");
    setActionError("");
    const objectUrl = URL.createObjectURL(file);
    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setLoadError("This photo could not be opened. Choose a JPEG, PNG, or WebP image.");
    nextImage.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    drawCrop(canvasRef.current, image, zoom, offsetX, offsetY, PREVIEW_SIZE);
  }, [image, offsetX, offsetY, zoom]);

  const resetCrop = useCallback(() => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }, []);

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, offsetX, offsetY };
  }

  function moveCrop(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setOffsetX(clamp(drag.offsetX + ((event.clientX - drag.clientX) / bounds.width) * 200, -100, 100));
    setOffsetY(clamp(drag.offsetY + ((event.clientY - drag.clientY) / bounds.height) * 200, -100, 100));
  }

  async function confirmCrop() {
    if (!file || !image || processing) return;
    setProcessing(true);
    setActionError("");
    try {
      const cropped = await croppedAvatarFile(file, image, zoom, offsetX, offsetY);
      const saved = await onConfirm(cropped);
      if (saved) onClose();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The cropped photo could not be created");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => { if (!open && !processing) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="flex-col items-start gap-1 pr-14">
          <DialogTitle>Crop profile photo</DialogTitle>
          <DialogDescription>
            Drag to reposition {profileName}&apos;s photo, then adjust the zoom before saving.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5 py-5">
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
          ) : (
            <div className="mx-auto aspect-square w-full max-w-80 rounded-full bg-muted p-1 shadow-[0_0_0_1px_var(--border)]">
              <canvas
                ref={canvasRef}
                aria-label="Profile photo crop preview"
                className="size-full touch-none cursor-grab rounded-full bg-muted active:cursor-grabbing"
                onPointerDown={startDrag}
                onPointerMove={moveCrop}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }}
              />
            </div>
          )}

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><ZoomIn className="size-4" /> Zoom</span>
                <span className="tabular-nums text-xs font-normal text-muted-foreground">{zoom.toFixed(1)}×</span>
              </span>
              <Input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                disabled={!image || processing}
                className="h-10 cursor-pointer border-0 px-0 shadow-none"
                aria-label="Photo zoom"
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-center gap-2"><Move className="size-4" /> Left or right</span>
                <Input type="range" min="-100" max="100" value={offsetX} onChange={(event) => setOffsetX(Number(event.target.value))} disabled={!image || processing} className="h-10 cursor-pointer border-0 px-0 shadow-none" aria-label="Move photo left or right" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-center gap-2"><Move className="size-4" /> Up or down</span>
                <Input type="range" min="-100" max="100" value={offsetY} onChange={(event) => setOffsetY(Number(event.target.value))} disabled={!image || processing} className="h-10 cursor-pointer border-0 px-0 shadow-none" aria-label="Move photo up or down" />
              </label>
            </div>
            <Button type="button" variant="ghost" className="h-10 self-start" onClick={resetCrop} disabled={!image || processing}>
              <RotateCcw data-icon="inline-start" /> Reset crop
            </Button>
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
