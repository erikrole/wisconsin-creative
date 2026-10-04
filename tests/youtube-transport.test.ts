import { describe, expect, it, vi } from "vitest";

import { createTransport } from "@/lib/youtube/transport";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";

const snapshot = {
  id: "hl", title: "New title", description: "New description", categoryId: "17", isPublic: true, isLive: false, channelId: BADGERS_CHANNEL_ID,
  status: { privacyStatus: "public", uploadStatus: "processed" },
};

describe("YouTube transport", () => {
  it("sends one snippet update with the etag in If-Match and nothing else", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await createTransport("token", fetcher as unknown as typeof fetch).update(snapshot, "etag-1");
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url.searchParams.get("part")).toBe("snippet");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("etag-1");
    expect(JSON.parse(init.body as string)).toEqual({ id: "hl", snippet: { title: "New title", description: "New description", categoryId: "17" } });
  });

  it("refuses launches and visibility changes", async () => {
    const transport = createTransport("token", vi.fn() as unknown as typeof fetch);
    await expect(transport.publish(snapshot, "e")).rejects.toThrow(/Only title and description/);
    await expect(transport.changeVisibility(snapshot, "e")).rejects.toThrow(/Only title and description/);
  });

  it("reads with the same parts as the library import", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "hl", etag: "e", snippet: { title: "T", description: "D", channelId: BADGERS_CHANNEL_ID, categoryId: "17", liveBroadcastContent: "none" }, status: { privacyStatus: "public" } }] }), { status: 200 }),
    );
    const live = await createTransport("token", fetcher as unknown as typeof fetch).read("hl");
    expect((fetcher.mock.calls[0] as [URL])[0].searchParams.get("part")).toBe("snippet,status");
    expect(live.snapshot.title).toBe("T");
  });
});
