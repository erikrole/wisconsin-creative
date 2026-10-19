"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

type AnnouncementMediaProps = {
  images: string[];
  alt: string | null;
  inert?: boolean;
};

/**
 * Banner across the top of the splash. One image is a plain banner; several
 * become a swipeable strip with dots. Scroll snapping does the swiping, so it
 * works with touch, trackpad, and keyboard without a carousel library.
 * An image that fails to load drops out rather than showing a broken icon.
 */
export function AnnouncementMedia({ images: allImages, alt, inert = false }: AnnouncementMediaProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const images = allImages.filter((src) => !failed.has(src));
  if (images.length === 0) return null;

  const multiple = images.length > 1;
  const label = alt?.trim() || "";

  function goTo(i: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="relative bg-muted">
      <div
        ref={trackRef}
        role={multiple ? "group" : undefined}
        aria-roledescription={multiple ? "carousel" : undefined}
        aria-label={multiple ? label || "Images" : undefined}
        tabIndex={multiple && !inert ? 0 : -1}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex aspect-[2/1] max-h-[40dvh] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none [scrollbar-width:none] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          <div key={`${src}-${i}`} className="relative h-full w-full shrink-0 snap-center">
            <Image
              src={src}
              alt={i === 0 ? label : ""}
              fill
              sizes="(max-width: 640px) 100vw, 440px"
              priority={i === 0}
              className="object-cover"
              draggable={false}
              onError={() => setFailed((prev) => new Set(prev).add(src))}
            />
          </div>
        ))}
      </div>
      {multiple ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur-sm">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                tabIndex={inert ? -1 : undefined}
                aria-label={`Image ${i + 1} of ${images.length}`}
                aria-current={i === index || undefined}
                onClick={() => goTo(i)}
                className={cn(
                  "h-1.5 rounded-full bg-white/55 transition-[width,background-color] duration-200 motion-reduce:transition-none",
                  i === index ? "w-4 bg-white" : "w-1.5",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
