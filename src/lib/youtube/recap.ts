// Server-only: turns an official UWBadgers recap page into a sentence-addressed
// document. Extracts only Sidearm's identified story body and never guesses
// from page chrome.

import { createHash } from "node:crypto";

import { YouTubeToolError, type RecapDocument, type RecapSentence } from "./types";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Rankings, initials, AP abbreviations and datelines must stay with the clause that follows.
const JOINS_NEXT = /(?:\b(?:No|Nos|Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|Jan|Feb|Aug|Sept|Oct|Nov|Dec)|\b[A-Z])\.$/;
const CONTINUES_PREVIOUS = /^(?:[—–]|--?\s|\p{Ll})/u;

function splitSentences(paragraph: string): string[] {
  const pieces = [...segmenter.segment(paragraph)].map((part) => part.segment.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && (JOINS_NEXT.test(previous) || CONTINUES_PREVIOUS.test(piece))) {
      merged[merged.length - 1] = `${previous} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

export function buildRecapDocument(url: string, paragraphs: string[], fetchedAt: Date = new Date()): RecapDocument {
  const sentences: RecapSentence[] = [];
  let timeSensitive = false;
  paragraphs.forEach((paragraph, index) => {
    if (/^(up next|next up|coming up)\b/i.test(paragraph)) timeSensitive = true;
    // Keep attributed quotations together; a fragment must not lose its speaker.
    const texts = paragraph.includes('"') || paragraph.includes("“") ? [paragraph] : splitSentences(paragraph);
    for (const text of texts) {
      sentences.push({ id: `${index}:${sha256(text).slice(0, 16)}`, paragraph: index, text, isTimeSensitive: timeSensitive });
    }
  });
  return { url, fetchedAt: fetchedAt.toISOString(), sha256: sha256(paragraphs.join("\n\n")), paragraphs, sentences };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•", copy: "©", reg: "®",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, key: string) => {
    if (key.startsWith("#x")) return safeCodePoint(parseInt(key.slice(2), 16)) ?? whole;
    if (key.startsWith("#")) return safeCodePoint(parseInt(key.slice(1), 10)) ?? whole;
    return NAMED_ENTITIES[key] ?? whole;
  });
}

function safeCodePoint(code: number): string | null {
  try {
    return Number.isFinite(code) ? String.fromCodePoint(code) : null;
  } catch {
    return null;
  }
}

export const RECAP_MAX_BYTES = 8_000_000;

export function extractRecap(html: string, url: string, fetchedAt: Date = new Date()): RecapDocument {
  if (Buffer.byteLength(html, "utf8") > RECAP_MAX_BYTES) throw new YouTubeToolError("The recap page is too large to inspect safely.");
  let clean = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const opening = /<div\b[^>]*\bid\s*=\s*["']storyPageContentBody["'][^>]*>/i.exec(clean);
  if (!opening) throw new YouTubeToolError("UWBadgers returned no recognized recap body. The saved source was kept.");
  clean = clean.slice(opening.index + opening[0].length);

  const divs = /<\/?div\b[^>]*>/gi;
  let depth = 1;
  let end = -1;
  for (let match = divs.exec(clean); match; match = divs.exec(clean)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = match.index;
      break;
    }
  }
  if (end < 0) throw new YouTubeToolError("The recap body is incomplete. The saved source was kept.");

  const body = clean
    .slice(0, end)
    .replace(/<blockquote\b[^>]*class\s*=\s*["'][^"']*twitter-tweet[^"']*["'][^>]*>[\s\S]*?<\/blockquote\s*>/gi, "")
    .replace(/<(?:iframe|figure)\b[^>]*>[\s\S]*?<\/(?:iframe|figure)\s*>/gi, "")
    .replace(/<br\b[^>]*>|<\/(?:p|h[1-6]|li|div)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const paragraphs = body
    .split("\n")
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && !line.startsWith("By:"));
  if (paragraphs.join("").length < 150) throw new YouTubeToolError("The extracted recap is unexpectedly short. Review the official page.");
  return buildRecapDocument(url, paragraphs, fetchedAt);
}
