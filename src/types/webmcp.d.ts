import type { WebMcpModelContext } from "@/lib/webmcp-tools";

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }

  interface Navigator {
    /** Deprecated early-preview alias retained for progressive enhancement. */
    readonly modelContext?: WebMcpModelContext;
  }
}

export {};
