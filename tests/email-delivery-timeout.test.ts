import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_SEND_TIMEOUT_MS, sendEmail } from "@/lib/email";

const message = {
  to: "student@example.com",
  subject: "Your booking",
  html: "<p>Ready</p>",
};

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe("sendEmail", () => {
  it("keeps the provider deadline well inside the Vercel Hobby function budget", () => {
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(4_000);
    expect(EMAIL_SEND_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it("preserves the development fallback without making a network request", async () => {
    const fetchMock = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(message)).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[EMAIL-DEV] To: student@example.com | Subject: Your booking",
    );
  });

  it("passes an aborting signal through the real Resend client and returns false on timeout", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Wisconsin Creative <gear@example.com>";
    await import("resend");
    vi.useFakeTimers();

    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sendEmail(message);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);

    await expect(result).resolves.toBe(false);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout after a successful Resend response", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await import("resend");
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(message)).resolves.toBe(true);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
