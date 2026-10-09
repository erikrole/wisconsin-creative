import { NextResponse } from "next/server";
import { withHandler } from "@/lib/api-handler";
import { releaseSlug, releases } from "@/lib/releases";

export const dynamic = "force-static";

const SITE = "https://wisconsincreative.com";
const FEED_LIMIT = 50;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderFeed() {
  const items = releases.slice(0, FEED_LIMIT).map((release) => {
    const link = `${SITE}/releases#${releaseSlug(release)}`;
    const details = release.details?.length
      ? `<ul>${release.details.map((detail) => `<li>${escapeXml(detail)}</li>`).join("")}</ul>`
      : "";
    const description = `<p>${escapeXml(release.summary)}</p>${details}`;
    return [
      "<item>",
      `<title>${escapeXml(release.title)}</title>`,
      `<link>${link}</link>`,
      `<guid isPermaLink="true">${link}</guid>`,
      `<pubDate>${new Date(`${release.date}T12:00:00Z`).toUTCString()}</pubDate>`,
      ...release.platforms.map((platform) => `<category>${escapeXml(platform)}</category>`),
      `<description><![CDATA[${description}]]></description>`,
      "</item>",
    ].join("");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    "<title>Wisconsin Creative Releases</title>",
    `<link>${SITE}/releases</link>`,
    `<atom:link href="${SITE}/releases/feed.xml" rel="self" type="application/rss+xml" />`,
    "<description>New features, improvements, and fixes across web, iOS, the checkout kiosk, and the macOS menu bar app.</description>",
    "<language>en-us</language>",
    ...items,
    "</channel>",
    "</rss>",
  ].join("");

  return xml;
}

export const GET = withHandler(async () =>
  new NextResponse(renderFeed(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  }),
);
