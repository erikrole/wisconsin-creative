import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS checkout return Live Activity source contract", () => {
  it("wires ActivityKit, the widget extension, and booking deep links into the project", () => {
    const project = source("ios/project.yml");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(project).toContain("NSSupportsLiveActivities: true");
    expect(project).toContain("WisconsinLiveActivities:");
    expect(project).toContain("com.apple.widgetkit-extension");
    expect(project).toContain("CFBundleURLSchemes:");
    expect(project).toContain("- wisconsin");
    expect(app).toContain('url.host == "booking"');
    // A booking link routes to booking detail and nothing else. Extend is an
    // action taken deliberately on that page, never opened by a tapped link, so
    // no routing slot may carry a link straight into a mutation sheet.
    expect(app).toContain("appState.pendingPushBookingId = bookingId");
    expect(app).not.toContain("pendingExtendBookingId");
    expect(app).not.toContain('value == "extend"');
    expect(source("ios/Wisconsin/Core/AppState.swift")).not.toContain("pendingExtendBookingId");
    expect(source("ios/Wisconsin/Views/BookingDetailView.swift")).not.toContain("pendingExtendBookingId");
    expect(tabs).toContain("routePendingBookingPush()");
    expect(tabs).toContain("appState.selectedTab = 0");
  });

  it("keeps every Live Activity surface glanceable at minute precision", () => {
    const attributes = source("ios/Wisconsin/LiveActivities/CheckoutReturnActivityAttributes.swift");
    const manager = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    const widget = source("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift");

    expect(attributes).toContain("struct CheckoutReturnActivityAttributes: ActivityAttributes");
    expect(attributes).toContain("var nextNeedAt: Date?");
    expect(attributes).toContain("var allowsExtend: Bool");
    expect(attributes).toContain("var requesterAvatarUrl: String?");
    expect(attributes).toContain("enum Urgency");
    expect(widget).toContain("ActivityConfiguration(for: CheckoutReturnActivityAttributes.self)");
    expect(widget).toContain("CheckoutReturnLockScreen(context: context, now: timeline.date)");
    expect(widget).toContain("ExpandedReturnStatus(context: context, now: timeline.date)");
    // Anchor every refresh lattice on `endsAt`, not on render time: a
    // render-time anchor ticks at an arbitrary phase, so the minute label and
    // the urgency accent can trail the real boundary by up to 59 seconds.
    expect(attributes).toContain("func minuteBoundaryAnchor(at date: Date) -> Date");
    expect(widget).toContain("TimelineView(.periodic(from: context.state.minuteBoundaryAnchor(at: .now), by: 60))");
    expect(widget).not.toContain("TimelineView(.periodic(from: .now, by: 60))");
    expect(widget).not.toContain("TimelineView(.periodic(from: .now, by: 1))");
    expect(widget).not.toContain("timerInterval:");
    expect(widget).toContain("context.state.minuteLabel(at: now)");
    expect(widget).toContain("state.urgency(at: date)");
    expect(widget).not.toContain(".minimumScaleFactor(0.72)");
    expect(widget).toContain(".activityBackgroundTint(.liveActivitySurface)");
    expect(widget).toContain(".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)");
    expect(widget).not.toContain(".clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))");
    expect(attributes).toContain("func minuteLabel(at date: Date) -> String");
    expect(attributes).toContain("? \"\\(minutes) min overdue\"");
    // One presentation resolver feeds lock screen, Dynamic Island, and watch,
    // so no surface can disagree about the same return's urgency.
    expect(widget).toContain("private struct ReturnPresentation");
    expect(widget.match(/case \.critical, \.overdue: return isDimmed/g)).toHaveLength(1);
    // The header icon sits next to words and says what the card is about; only
    // the standalone Dynamic Island glyph carries urgency on its own.
    expect(widget).toContain('return isUnconfirmed ? "arrow.triangle.2.circlepath" : "shippingbox.fill"');
    expect(widget).toContain("var glyph: String");
    expect(widget).not.toContain("resolved.icon");

    // Past the stale date the card keeps the local countdown but stops
    // asserting an urgency nothing has confirmed.
    expect(widget).toContain("isStale: context.isStale");
    expect(widget).toContain("isUnconfirmed = isStale && resolved != .returned");
    expect(widget).toContain("Open Wisconsin to confirm");
    expect(widget).toContain("liveActivityMuted");

    // Paired Apple Watch gets a real small-family layout instead of a scaled
    // lock-screen card, and always-on display drops to dimmed accents.
    expect(widget).toContain(".supplementalActivityFamilies([.small])");
    expect(widget).toContain("@Environment(\\.activityFamily)");
    expect(widget).toContain("case .small:");
    expect(widget).toContain("CheckoutReturnSmallView(context: context, now: timeline.date)");
    expect(widget).toContain("@Environment(\\.isLuminanceReduced)");
    expect(widget).toContain("liveActivityRedDim");

    // Compact and minimal presentations carry no words of their own.
    expect(widget).toContain("private func glanceAccessibilityLabel(");
    expect(widget.match(/\.accessibilityLabel\(glanceAccessibilityLabel\(for: context, at: timeline\.date\)\)/g)).toHaveLength(2);

    expect(manager).toContain("requesterAvatarUrl: candidate.booking.requester.avatarUrl");
    expect(widget).not.toContain("AsyncImage(url: url)");
    expect(widget).not.toContain("context.attributes.requesterName");
    expect(widget).not.toContain("context.attributes.requesterInitials");
  });

  it("uses availability next-need insight to start early, intensify urgency, and gate Extend", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const manager = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const widget = source("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift");
    const attributes = source("ios/Wisconsin/LiveActivities/CheckoutReturnActivityAttributes.swift");

    expect(api).toContain("struct CheckoutReturnInsight");
    expect(api).toContain("let upcomingCommitments: [UpcomingCommitment]?");
    expect(api).toContain("excludeBookingId: booking.id");
    expect(manager).toContain("private let defaultLeadTime: TimeInterval = 30 * 60");
    expect(manager).toContain("private let maxNextNeedLeadTime: TimeInterval = 60 * 60");
    expect(manager).toContain("let smartLead = nextNeedGap.map");
    expect(manager).toContain("allowsExtend: !insight.hasUpcomingNeed");
    // No Extend affordance on this surface in any form: not a deep-link
    // parameter, not an App Intent button, not a label. Tapping opens booking
    // detail, where Extend is chosen deliberately.
    expect(widget).not.toContain('URLQueryItem(name: "action", value: "extend")');
    expect(widget).not.toContain("context.state.allowsExtend");
    expect(widget).not.toContain("Button(intent:");
    expect(widget).not.toContain("LiveActivityIntent");
    expect(widget).not.toContain('"Extend"');
    expect(attributes).toContain("Deliberately never rendered.");
    expect(widget).toContain("Needed again");
    expect(detail).toContain("returnInsight.hasUpcomingNeed");
    expect(detail).toContain("showExtend = true");
  });

  it("keeps one urgent checkout activity and dismisses locally when the checkout is no longer open", () => {
    const manager = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(manager).toContain("limit: 5");
    expect(manager).toContain(".checkouts(activeOnly: false, status: .open");
    expect(manager).toContain("candidates.sorted(by: candidateSort).first");
    expect(manager).toContain("activity.attributes.bookingId != candidate.booking.id");
    expect(manager).toContain("dismissalPolicy: .immediate");
    expect(manager).toContain("Activity.request(attributes: attributes, content: content, pushType: .token)");
    expect(manager).toContain("activity.pushTokenUpdates");
    expect(manager).toContain("registerCheckoutReturnLiveActivity");
    expect(detail).toContain("booking.status != .open");
    expect(detail).toContain("CheckoutReturnLiveActivityManager.shared.endAll()");
    expect(app).toContain("CheckoutReturnLiveActivityManager.shared.endAll()");
    expect(home).toContain("CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts");
    expect(bookings).toContain("CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts");
  });

  it("stores Live Activity tokens separately and sends end pushes when checkout return completes", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/0088_checkout_live_activity_tokens/migration.sql");
    const startMigration = source("prisma/migrations/0091_checkout_live_activity_push_to_start/migration.sql");
    const route = source("src/app/api/live-activities/checkout-return/route.ts");
    const startTokenRoute = source("src/app/api/live-activities/checkout-return/start-token/route.ts");
    const service = source("src/lib/services/live-activities.ts");
    const apns = source("src/lib/push/apns.ts");
    const checkin = source("src/lib/services/bookings-checkin.ts");

    expect(schema).toContain("model LiveActivityToken");
    expect(schema).toContain("model LiveActivityStartToken");
    expect(schema).toContain("model LiveActivityStart");
    expect(schema).toContain("@@map(\"live_activity_tokens\")");
    expect(schema).toContain("@@map(\"live_activity_start_tokens\")");
    expect(schema).toContain("@@map(\"live_activity_starts\")");
    expect(migration).toContain("CREATE TABLE \"live_activity_tokens\"");
    expect(startMigration).toContain("CREATE TABLE \"live_activity_start_tokens\"");
    expect(startMigration).toContain("CREATE TABLE \"live_activity_starts\"");
    expect(route).toContain("booking.requesterUserId !== user.id");
    expect(route).toContain("booking.status !== BookingStatus.OPEN");
    expect(route).toContain("tx.user.findUnique");
    expect(route).toContain("tx.liveActivityToken.upsert");
    expect(startTokenRoute).toContain("tx.user.findUnique");
    expect(startTokenRoute).toContain("tx.liveActivityStartToken.upsert");
    expect(startTokenRoute).toContain("revokeCheckoutReturnLiveActivityStartTokens");
    expect(startTokenRoute).toContain("export const DELETE = withAuth");
    expect(service).not.toContain("export async function registerCheckoutReturnLiveActivity(");
    expect(service).not.toContain("export async function registerCheckoutReturnLiveActivityStartToken(");
    expect(service).toContain("endCheckoutReturnLiveActivities");
    expect(service).toContain("updateCheckoutReturnLiveActivities");
    expect(apns).toContain('"apns-push-type": opts.pushType');
    expect(apns).toContain("push-type.liveactivity");
    expect(apns).toContain('event: "end"');
    expect(apns).toContain('event: "update"');
    expect(checkin).toContain("endCheckoutReturnLiveActivities(bookingId)");
    expect(checkin).toContain("endCheckoutReturnLiveActivities(args.bookingId)");
  });

  it("pushes Live Activity updates for server-known checkout changes without requiring app launch", () => {
    const lifecycle = source("src/lib/services/bookings-lifecycle.ts");
    const service = source("src/lib/services/live-activities.ts");

    expect(lifecycle).toContain("updateCheckoutReturnLiveActivities({");
    expect(lifecycle).toContain("endCheckoutReturnLiveActivities(bookingId)");
    expect(service).toContain("updateCheckoutReturnLiveActivityTokens");
    expect(service).toContain("endsAt: args.endsAt");
  });

  it("registers push-to-start tokens and keeps the server start route available for Pro/manual schedulers", () => {
    const api = source("ios/Wisconsin/Core/APIClient.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const session = source("ios/Wisconsin/Core/SessionStore.swift");
    const manager = source("ios/Wisconsin/LiveActivities/CheckoutReturnLiveActivityManager.swift");
    const service = source("src/lib/services/live-activities.ts");
    const apns = source("src/lib/push/apns.ts");
    const cron = source("src/app/api/cron/live-activities/route.ts");
    const vercel = source("vercel.json");

    expect(api).toContain("registerCheckoutReturnLiveActivityStartToken");
    expect(api).toContain("revokeCheckoutReturnLiveActivityStartTokens");
    expect(app).toContain("prepareRemoteStartRegistration()");
    expect(session).toContain("revokeCheckoutReturnLiveActivityStartTokens()");
    expect(manager).toContain("pushToStartTokenUpdates");
    expect(manager).toContain("Activity<CheckoutReturnActivityAttributes>.activityUpdates");
    expect(manager).toContain("activity.pushToken");
    expect(manager).toContain("registerCheckoutReturnLiveActivityStartToken(token)");
    expect(manager).toContain("registerCheckoutReturnLiveActivity(");
    expect(service).toContain("startDueCheckoutReturnLiveActivities");
    expect(service).toContain("liveActivityStartTokens");
    expect(service).toContain("liveActivityStarts");
    expect(apns).toContain("startCheckoutReturnLiveActivityTokens");
    expect(apns).toContain('event: "start"');
    expect(apns).toContain('"attributes-type": "CheckoutReturnActivityAttributes"');
    expect(apns).toContain('"input-push-token": 1');
    expect(cron).toContain("withCron");
    expect(cron).toContain("startDueCheckoutReturnLiveActivities({ limit: 5 })");
    expect(cron).toContain("sweepOverdueCheckoutReturnLiveActivities({ limit: 5 })");
    expect(cron).toContain("retryPendingCheckoutReturnLiveActivityEnds({ limit: 50 })");
    expect(service.match(/Promise\.allSettled\(/g)).toHaveLength(2);
    expect(apns).toContain("APNS_STREAM_BATCH_SIZE = 250");
    expect(apns).toContain("APNS_PARALLEL_BATCHES = 4");
    expect(vercel).not.toContain("/api/cron/live-activities");
    expect(vercel).not.toContain("*/5 * * * *");
    expect(vercel).not.toContain("*/15 * * * *");
  });

  it("durably schedules remote start 30 minutes before return without an app launch", () => {
    const config = source("next.config.ts");
    const scheduler = source("src/lib/live-activity-workflow.ts");
    const workflow = source("src/workflows/checkout-return-live-activity.ts");
    const service = source("src/lib/services/live-activities.ts");
    const lifecycle = source("src/lib/services/bookings-lifecycle.ts");
    const kioskComplete = source("src/app/api/kiosk/checkout/complete/route.ts");
    const kioskCheckout = source("src/app/api/kiosk/checkout/[id]/route.ts");

    expect(config).toContain('import { withWorkflow } from "workflow/next"');
    expect(config).toContain("withWorkflow(withBundleAnalyzer(nextConfig))");
    expect(scheduler).toContain("30 * 60_000");
    expect(scheduler).toContain("await start(checkoutReturnLiveActivityWorkflow");
    expect(workflow).toContain('"use workflow"');
    expect(workflow).toContain("await sleep(wakeAt)");
    expect(workflow).toContain('"use step"');
    expect(workflow).toContain("expectedEndsAtIso");
    expect(service).toContain("startCheckoutReturnLiveActivityForBooking");
    expect(service).toContain("endsAt: args.expectedEndsAt");
    expect(service).toContain("status: BookingStatus.OPEN");
    expect(service).toContain("liveActivityStarts:");
    expect(service).toContain("liveActivityStartTokens:");
    expect(lifecycle).toContain("scheduleCheckoutReturnLiveActivity({ bookingId: booking.id");
    expect(lifecycle).toContain("scheduleCheckoutReturnLiveActivity({ bookingId, endsAt: updated.endsAt })");
    expect(kioskComplete).toContain("scheduleCheckoutReturnLiveActivity({");
    expect(kioskCheckout).toContain("scheduleCheckoutReturnLiveActivity({ bookingId: updated.id");
  });
});
