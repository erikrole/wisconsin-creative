import { describe, expect, it } from "vitest";
import {
  createWebMcpTools,
  getWebMcpPages,
  registerWebMcpTools,
  WEBMCP_ITEM_TYPES,
  type WebMcpModelContext,
} from "@/lib/webmcp-tools";

const navigate = () => undefined;

describe("WebMCP tool contract", () => {
  it("keeps the default tool surface read-only and role-aware", () => {
    const tools = createWebMcpTools({
      user: { role: "STUDENT" },
      getPathname: () => "/",
      getTitle: () => "Dashboard",
      navigate,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "gear-tracker.get-current-page",
      "gear-tracker.open-page",
      "gear-tracker.get-dashboard-snapshot",
      "gear-tracker.search-items",
      "gear-tracker.search-bookings",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.some((tool) => tool.name.includes("checkout") || tool.name.includes("reserve"))).toBe(false);
  });

  it("does not advertise collaborator tools beyond granted capabilities", () => {
    const tools = createWebMcpTools({
      user: { role: "COLLABORATOR", capabilities: ["PUBLISHED_SCHEDULE_VIEW"] },
      getPathname: () => "/schedule",
      getTitle: () => "Schedule",
      navigate,
    });

    expect(tools.map((tool) => tool.name)).not.toContain("gear-tracker.search-items");
    expect(tools.map((tool) => tool.name)).not.toContain("gear-tracker.search-bookings");
    expect(getWebMcpPages({ role: "COLLABORATOR", capabilities: ["PUBLISHED_SCHEDULE_VIEW"] }).map((page) => page.key)).toEqual([
      "dashboard",
      "schedule",
      "scoreboard",
      "notifications",
      "profile",
    ]);
  });

  it("keeps the item-kind schema aligned with the existing Items API", () => {
    expect(WEBMCP_ITEM_TYPES).toEqual(["all", "serialized", "unit-tracked", "quantity-tracked"]);
    const tools = createWebMcpTools({
      user: { role: "STAFF" },
      getPathname: () => "/items",
      getTitle: () => "Items",
      navigate,
    });
    const search = tools.find((tool) => tool.name === "gear-tracker.search-items");
    expect(search?.inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
    });
    expect(search?.inputSchema).toMatchObject({
      properties: { itemType: { enum: [...WEBMCP_ITEM_TYPES] } },
    });
  });

  it("registers the role-filtered surface with the abort lifecycle", async () => {
    const tools = createWebMcpTools({
      user: { role: "STAFF" },
      getPathname: () => "/",
      getTitle: () => "Dashboard",
      navigate,
    });
    const controller = new AbortController();
    const registered: string[] = [];
    const signals: AbortSignal[] = [];
    const context: WebMcpModelContext = {
      registerTool: async (tool, options) => {
        registered.push(tool.name);
        if (options?.signal) signals.push(options.signal);
      },
    };

    await registerWebMcpTools(context, tools, controller.signal);

    expect(registered).toEqual(tools.map((tool) => tool.name));
    expect(signals).toHaveLength(tools.length);
    expect(new Set(signals)).toEqual(new Set([controller.signal]));
  });
});
