import {
  BookingKind,
  BookingStatus,
  BulkMovementKind,
  Prisma,
  ScanSessionStatus,
  type Role,
} from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { hashPassword, randomHex } from "@/lib/auth";
import { deleteImage, isBlobUrl } from "@/lib/blob";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createShiftScheduleNotification } from "@/lib/services/notifications";
import { releaseReservationManagedAssignmentTx } from "@/lib/services/reservation-schedule";
import { revokeCompanionUser } from "@/lib/companion-store";
import { refreshCompanionProjection } from "@/lib/services/companion-projection";

export type UserDeactivationResult = {
  cancelledIds: string[];
  directReportsCleared: number;
};

type PendingPickupBulkRestoration = {
  bookingId: string;
  bulkSkuId: string;
  locationId: string;
  quantity: number;
};

async function restorePendingPickupBulkStock(
  tx: Prisma.TransactionClient,
  args: {
    actorUserId: string;
    restorations: PendingPickupBulkRestoration[];
  },
) {
  if (args.restorations.length === 0) return;

  const balanceDeltasByKey = new Map<
    string,
    { bulkSkuId: string; locationId: string; quantity: number }
  >();
  for (const restoration of args.restorations) {
    const key = `${restoration.bulkSkuId}\u0000${restoration.locationId}`;
    const existing = balanceDeltasByKey.get(key);
    if (existing) {
      existing.quantity += restoration.quantity;
    } else {
      balanceDeltasByKey.set(key, {
        bulkSkuId: restoration.bulkSkuId,
        locationId: restoration.locationId,
        quantity: restoration.quantity,
      });
    }
  }

  const balanceDeltas = [...balanceDeltasByKey.values()].sort((left, right) => {
    const locationOrder = left.locationId.localeCompare(right.locationId);
    return locationOrder !== 0
      ? locationOrder
      : left.bulkSkuId.localeCompare(right.bulkSkuId);
  });
  const existingBalances = await tx.bulkStockBalance.findMany({
    where: {
      OR: balanceDeltas.map((balance) => ({
        bulkSkuId: balance.bulkSkuId,
        locationId: balance.locationId,
      })),
    },
    select: {
      bulkSkuId: true,
      locationId: true,
      onHandQuantity: true,
    },
  });
  const existingByKey = new Map(
    existingBalances.map((balance) => [
      `${balance.bulkSkuId}\u0000${balance.locationId}`,
      balance.onHandQuantity,
    ]),
  );

  const updates: Array<{
    bulkSkuId: string;
    locationId: string;
    next: number;
  }> = [];
  const creates: Array<{
    bulkSkuId: string;
    locationId: string;
    onHandQuantity: number;
  }> = [];
  for (const balance of balanceDeltas) {
    const key = `${balance.bulkSkuId}\u0000${balance.locationId}`;
    const current = existingByKey.get(key) ?? 0;
    const next = current + balance.quantity;
    if (next < 0) {
      throw new HttpError(
        409,
        `Insufficient bulk stock for ${balance.bulkSkuId}. On hand: ${current}, required: ${balance.quantity}`,
      );
    }

    if (existingByKey.has(key)) {
      updates.push({
        bulkSkuId: balance.bulkSkuId,
        locationId: balance.locationId,
        next,
      });
    } else {
      creates.push({
        bulkSkuId: balance.bulkSkuId,
        locationId: balance.locationId,
        onHandQuantity: next,
      });
    }
  }

  if (updates.length > 0) {
    const values = updates.map((update) => Prisma.sql`(
      CAST(${update.bulkSkuId} AS TEXT),
      CAST(${update.locationId} AS TEXT),
      CAST(${update.next} AS INTEGER)
    )`);
    const updatedCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "bulk_stock_balances" AS current
      SET
        "on_hand_quantity" = incoming.next_quantity,
        "updated_at" = NOW()
      FROM (
        VALUES ${Prisma.join(values)}
      ) AS incoming(bulk_sku_id, location_id, next_quantity)
      WHERE current."bulk_sku_id" = incoming.bulk_sku_id
        AND current."location_id" = incoming.location_id
    `);
    if (updatedCount !== updates.length) {
      throw new Error("One or more bulk stock balances changed during user deactivation");
    }
  }

  if (creates.length > 0) {
    await tx.bulkStockBalance.createMany({ data: creates });
  }

  await tx.bulkStockMovement.createMany({
    data: args.restorations.map((restoration) => ({
      bulkSkuId: restoration.bulkSkuId,
      locationId: restoration.locationId,
      bookingId: restoration.bookingId,
      actorUserId: args.actorUserId,
      kind: BulkMovementKind.CHECKIN,
      quantity: restoration.quantity,
    })),
  });
}

export async function deactivateUserWithCleanup(args: {
  targetUserId: string;
  actorId: string;
  actorRole: Role;
  /**
   * Self-service deletion erases direct identity/authentication data while
   * retaining the tombstone row needed by custody and audit foreign keys.
   * Administrative deactivation keeps the existing reversible lifecycle.
   */
  erasePersonalData?: boolean;
  audit?: {
    action: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}): Promise<UserDeactivationResult> {
  const {
    targetUserId,
    actorId,
    actorRole,
    erasePersonalData = false,
    audit,
  } = args;
  const releasedAssignmentIds: string[] = [];
  const erasedPasswordHash = erasePersonalData
    ? await hashPassword(`deleted-account:${randomHex(32)}`)
    : undefined;
  let avatarUrlToDelete: string | null = null;

  const deactivationResult = await db.$transaction(async (tx) => {
    const targetIdentity = erasePersonalData
      ? await tx.user.findUnique({
        where: { id: targetUserId },
        select: { email: true, avatarUrl: true },
      })
      : null;
    if (erasePersonalData && !targetIdentity) {
      throw new HttpError(404, "User not found");
    }
    avatarUrlToDelete = targetIdentity?.avatarUrl ?? null;

    const openCheckouts = await tx.booking.count({
      where: {
        requesterUserId: targetUserId,
        kind: "CHECKOUT",
        status: BookingStatus.OPEN,
      },
    });
    if (openCheckouts > 0) {
      throw new HttpError(
        400,
        `Cannot ${erasePersonalData ? "delete" : "deactivate"}: user has ${openCheckouts} open checkout${openCheckouts > 1 ? "s" : ""}. Return all gear first.`
      );
    }

    const toCancel = await tx.booking.findMany({
      where: {
        requesterUserId: targetUserId,
        status: { in: [BookingStatus.BOOKED, BookingStatus.DRAFT, BookingStatus.PENDING_PICKUP] },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        shiftAssignmentId: true,
        locationId: true,
        bulkItems: { select: { bulkSkuId: true, plannedQuantity: true } },
      },
    });

    if (toCancel.length > 0) {
      await restorePendingPickupBulkStock(tx, {
        actorUserId: actorId,
        restorations: toCancel.flatMap((booking) => {
          if (
            booking.kind !== BookingKind.CHECKOUT
            || booking.status !== BookingStatus.PENDING_PICKUP
          ) {
            return [];
          }
          return booking.bulkItems.map((item) => ({
            bookingId: booking.id,
            locationId: booking.locationId,
            bulkSkuId: item.bulkSkuId,
            quantity: item.plannedQuantity,
          }));
        }),
      });

      await tx.booking.updateMany({
        where: { id: { in: toCancel.map((b) => b.id) } },
        data: { status: BookingStatus.CANCELLED },
      });

      // Mark the whole cancellation set first so two reservations sharing one
      // reservation-managed assignment do not keep each other artificially
      // alive while this transaction reconciles their links.
      for (const booking of toCancel) {
        if (booking.kind !== BookingKind.RESERVATION || !booking.shiftAssignmentId) continue;
        const release = await releaseReservationManagedAssignmentTx(tx, {
          bookingId: booking.id,
          assignmentId: booking.shiftAssignmentId,
        });
        if (release.released && release.assignmentId) {
          releasedAssignmentIds.push(release.assignmentId);
          await createAuditEntryTx(tx, {
            actorId,
            actorRole,
            entityType: "shift_assignment",
            entityId: release.assignmentId,
            action: "shift_assignment_removed",
            before: {
              source: "event_gear_reservation",
              bookingId: booking.id,
            },
            after: { reason: "requester_deactivated" },
          });
        } else if (release.blocked) {
          await createAuditEntryTx(tx, {
            actorId,
            actorRole,
            entityType: "booking",
            entityId: booking.id,
            action: "schedule_assignment_review_needed",
            after: {
              status: "blocked_working_copy",
              reason: "Requester deactivation could not change an event's working schedule.",
            },
          });
        }
      }

      await tx.assetAllocation.updateMany({
        where: { bookingId: { in: toCancel.map((b) => b.id) } },
        data: { active: false },
      });
      await tx.scanSession.updateMany({
        where: { bookingId: { in: toCancel.map((b) => b.id) }, status: ScanSessionStatus.OPEN },
        data: { status: ScanSessionStatus.CANCELLED },
      });
    }

    const notificationAccessRevokedAt = new Date();
    await tx.session.deleteMany({ where: { userId: targetUserId } });
    const deviceTokenCleanup = await tx.deviceToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: notificationAccessRevokedAt },
    });
    const liveActivityStartTokenCleanup = await tx.liveActivityStartToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: notificationAccessRevokedAt },
    });
    const liveActivityTokensQueuedForEnd = await tx.liveActivityToken.count({
      where: { userId: targetUserId, endedAt: null },
    });
    const liveActivityStartsQueuedForEnd = await tx.liveActivityStart.count({
      where: { userId: targetUserId, endedAt: null },
    });
    const deviceTokenPersonalCleanup = erasePersonalData
      ? await tx.deviceToken.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const liveActivityStartTokenPersonalCleanup = erasePersonalData
      ? await tx.liveActivityStartToken.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const liveActivityTokenPersonalCleanup = erasePersonalData
      ? await tx.liveActivityToken.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const liveActivityStartPersonalCleanup = erasePersonalData
      ? await tx.liveActivityStart.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const passwordResetTokenCleanup = await tx.passwordResetToken.deleteMany({
      where: { userId: targetUserId },
    });
    const passkeyCredentialCleanup = erasePersonalData
      ? await tx.passkeyCredential.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const passkeyChallengeCleanup = erasePersonalData
      ? await tx.passkeyChallenge.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const notificationCleanup = erasePersonalData
      ? await tx.notification.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const webPushSubscriptionCleanup = erasePersonalData
      ? await tx.webPushSubscription.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const appInstallationCleanup = erasePersonalData
      ? await tx.userAppInstallation.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const favoriteItemCleanup = erasePersonalData
      ? await tx.favoriteItem.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const favoriteFamilyCleanup = erasePersonalData
      ? await tx.favoriteItemFamily.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const scheduleFollowCleanup = erasePersonalData
      ? await tx.scheduleEventFollow.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const availabilityCleanup = erasePersonalData
      ? await tx.studentAvailabilityBlock.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const sportAssignmentCleanup = erasePersonalData
      ? await tx.studentSportAssignment.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const areaAssignmentCleanup = erasePersonalData
      ? await tx.studentAreaAssignment.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const badgeCleanup = erasePersonalData
      ? await tx.studentBadge.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const badgeStreakCleanup = erasePersonalData
      ? await tx.badgeStreak.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const badgeReceiptCleanup = erasePersonalData
      ? await tx.badgeEventReceipt.deleteMany({ where: { userId: targetUserId } })
      : { count: 0 };
    const claimedInviteCleanup = erasePersonalData
      ? await tx.allowedEmail.updateMany({
        where: {
          OR: [
            { claimedById: targetUserId },
            { email: targetIdentity?.email ?? "" },
          ],
        },
        data: {
          email: `deleted+${targetUserId}@deleted.invalid`,
          claimedById: null,
          claimedAt: null,
          preloadedName: null,
        },
      })
      : { count: 0 };
    const licenseClaimCleanup = erasePersonalData
      ? await tx.licenseCodeClaim.updateMany({
        where: { userId: targetUserId },
        data: { userId: null, occupantLabel: null },
      })
      : { count: 0 };
    const directReportCleanup = await tx.user.updateMany({
      where: { directReportId: targetUserId },
      data: { directReportId: null },
    });
    await tx.user.update({
      where: { id: targetUserId },
      data: erasePersonalData
        ? {
          active: false,
          name: "Deleted User",
          email: `deleted+${targetUserId}@deleted.invalid`,
          passwordHash: erasedPasswordHash!,
          forcePasswordChange: false,
          affiliation: null,
          collaboratorProfile: null,
          hiddenFromRoster: true,
          phone: null,
          personalPhone: null,
          workPhone: null,
          workPhoneNotApplicable: false,
          wiscardNumber: null,
          wiscardCardNumber: null,
          wiscardIssueCode: null,
          profilePromptSnoozedUntil: null,
          slackHandle: null,
          slackProfileUrl: null,
          avatarUrl: null,
          primaryArea: null,
          locationId: null,
          lastActiveAt: null,
          directReportId: null,
          directReportName: null,
          title: null,
          athleticsEmail: null,
          startDate: null,
          gradYear: null,
          graduationTerm: null,
          studentYearOverride: null,
          topSizeFit: null,
          topSize: null,
          bottomSize: null,
          shoeSizeSystem: null,
          shoeSize: null,
          birthdayMonth: null,
          birthdayDay: null,
          birthYear: null,
          notificationPrefs: Prisma.JsonNull,
          icsToken: null,
        }
        : { active: false },
    });

    const result = {
      cancelledIds: toCancel.map((b) => b.id),
      directReportsCleared: directReportCleanup.count,
      notificationAccessRevoked: {
        deviceTokens: deviceTokenCleanup.count,
        liveActivityStartTokens: liveActivityStartTokenCleanup.count,
        liveActivityTokensQueuedForEnd,
        liveActivityStartsQueuedForEnd,
        passwordResetTokens: passwordResetTokenCleanup.count,
      },
      personalDataErased: erasePersonalData,
      personalDataRecordsRemoved: erasePersonalData
        ? {
          passkeyCredentials: passkeyCredentialCleanup.count,
          passkeyChallenges: passkeyChallengeCleanup.count,
          deviceTokens: deviceTokenPersonalCleanup.count,
          liveActivityStartTokens: liveActivityStartTokenPersonalCleanup.count,
          liveActivityTokens: liveActivityTokenPersonalCleanup.count,
          liveActivityStarts: liveActivityStartPersonalCleanup.count,
          notifications: notificationCleanup.count,
          webPushSubscriptions: webPushSubscriptionCleanup.count,
          appInstallations: appInstallationCleanup.count,
          favorites: favoriteItemCleanup.count + favoriteFamilyCleanup.count,
          scheduleFollows: scheduleFollowCleanup.count,
          availabilityBlocks: availabilityCleanup.count,
          sportAssignments: sportAssignmentCleanup.count,
          areaAssignments: areaAssignmentCleanup.count,
          badges: badgeCleanup.count + badgeStreakCleanup.count + badgeReceiptCleanup.count,
          claimedInvites: claimedInviteCleanup.count,
          licenseClaims: licenseClaimCleanup.count,
        }
        : undefined,
    };

    const cleanupAfter: Record<string, unknown> = {
      cancelledBookingIds: result.cancelledIds,
      cancelledCount: result.cancelledIds.length,
      directReportsCleared: result.directReportsCleared,
      notificationAccessRevoked: result.notificationAccessRevoked,
    };
    if (erasePersonalData) {
      cleanupAfter.personalDataErased = true;
      cleanupAfter.personalDataRecordsRemoved = result.personalDataRecordsRemoved;
    }
    const revokedNotificationAccessCount = Object.values(
      result.notificationAccessRevoked
    ).reduce((sum, count) => sum + count, 0);
    if (
      result.cancelledIds.length > 0
      || result.directReportsCleared > 0
      || revokedNotificationAccessCount > 0
      || erasePersonalData
    ) {
      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "user",
        entityId: targetUserId,
        action: "deactivation_cleanup",
        after: cleanupAfter,
      });
    }

    if (audit) {
      await createAuditEntryTx(tx, {
        actorId,
        actorRole,
        entityType: "user",
        entityId: targetUserId,
        action: audit.action,
        before: audit.before,
        after: {
          ...(audit.after ?? {}),
          ...cleanupAfter,
        },
      });
    }

    return result;
  }, { isolationLevel: "Serializable" });

  if (erasePersonalData && avatarUrlToDelete && isBlobUrl(avatarUrlToDelete)) {
    await deleteImage(avatarUrlToDelete).catch((error) => {
      // The database no longer exposes the avatar after the transaction. A
      // failed best-effort blob delete must not roll back the account erase.
      console.error("[Account deletion] failed to remove profile photo", error);
    });
  }

  let companionRevocationError: unknown;
  try {
    await revokeCompanionUser(targetUserId);
  } catch (error) {
    companionRevocationError = error;
    console.error("[Companion] failed to revoke deactivated user", error);
  }
  const notificationResults = await Promise.allSettled(
    releasedAssignmentIds.map((assignmentId) =>
      createShiftScheduleNotification(assignmentId, "removed"),
    ),
  );
  if (deactivationResult.cancelledIds.length > 0) {
    await refreshCompanionProjection({ notify: true }).catch((error) => {
      console.error("[Companion] failed to publish deactivation cancellations", error);
    });
  }
  if (companionRevocationError) {
    throw new HttpError(
      503,
      `The account was ${erasePersonalData ? "deleted" : "deactivated"}, but companion access could not be revoked. Retry the ${erasePersonalData ? "deletion" : "deactivation"} cleanup.`,
    );
  }
  const notificationFailure = notificationResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (notificationFailure) throw notificationFailure.reason;

  return {
    cancelledIds: deactivationResult.cancelledIds,
    directReportsCleared: deactivationResult.directReportsCleared,
  };
}
