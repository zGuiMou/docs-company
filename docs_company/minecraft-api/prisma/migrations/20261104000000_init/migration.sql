CREATE TABLE "player_accounts" (
    "player_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "player_accounts_pkey" PRIMARY KEY ("player_id"),
    CONSTRAINT "player_accounts_balance_nonnegative" CHECK ("balance" >= 0)
);

CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "from_player_id" UUID NOT NULL,
    "to_player_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transfers_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "transfers_distinct_players" CHECK ("from_player_id" <> "to_player_id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "actor_id" VARCHAR(100) NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transfers_idempotency_key_key" ON "transfers"("idempotency_key");
CREATE INDEX "transfers_from_player_id_created_at_idx" ON "transfers"("from_player_id", "created_at");
CREATE INDEX "transfers_to_player_id_created_at_idx" ON "transfers"("to_player_id", "created_at");
CREATE UNIQUE INDEX "audit_events_transfer_id_key" ON "audit_events"("transfer_id");
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_player_id_fkey"
    FOREIGN KEY ("from_player_id") REFERENCES "player_accounts"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_player_id_fkey"
    FOREIGN KEY ("to_player_id") REFERENCES "player_accounts"("player_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();