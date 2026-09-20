// Safe video embeds for the Markdown reader.
//
// Authors write a fenced code block tagged `embed` (or `video`) whose body is a URL:
//
//   ```embed
//   https://www.youtube.com/watch?v=dQw4w9WgXcQ
//   ```
//
// We never pass an author-supplied URL straight into an <iframe>. Instead we parse
// out a known provider + validated id and construct the embed URL ourselves, so a
// hostile string can only ever resolve to a trusted player origin or fall back to a
// plain link.

type EmbedProvider = "youtube" | "vimeo";

type ParsedEmbed = {
  src: string;
  provider: EmbedProvider;
  title: string;
};

const YT_ID_RE = /^[\w-]{11}$/;
const VIMEO_ID_RE = /^\d{6,}$/;

function safeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function youtube(id: string): ParsedEmbed {
  return { src: `https://www.youtube.com/embed/${id}`, provider: "youtube", title: "YouTube video" };
}

export function parseEmbed(raw: string): ParsedEmbed | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const queryId = url.searchParams.get("v");
    if (queryId && YT_ID_RE.test(queryId)) return youtube(queryId);
    const pathId = url.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{11})/)?.[1];
    if (pathId) return youtube(pathId);
    return null;
  }

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YT_ID_RE.test(id) ? youtube(id) : null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).find((seg) => VIMEO_ID_RE.test(seg));
    if (id) return { src: `https://player.vimeo.com/video/${id}`, provider: "vimeo", title: "Vimeo video" };
    return null;
  }

  return null;
}
