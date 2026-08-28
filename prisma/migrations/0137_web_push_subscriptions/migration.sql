-- Browser Push subscriptions are separate from native APNs/FCM device tokens.
-- The endpoint is a browser capability, while p256dh/auth are required to
-- encrypt each payload for that endpoint.
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key"
    ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_user_id_revoked_at_idx"
    ON "web_push_subscriptions"("user_id", "revoked_at");

ALTER TABLE "web_push_subscriptions"
    ADD CONSTRAINT "web_push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
