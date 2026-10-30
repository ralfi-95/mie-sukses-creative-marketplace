CREATE TABLE IF NOT EXISTS wallet_topup_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users,
 amount bigint NOT NULL CHECK(amount > 0),
 method text NOT NULL CHECK(method IN ('bank_transfer','e_wallet','qris')),
 provider text,
 idempotency_key uuid NOT NULL,
 status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','completed','cancelled')),
 wallet_transaction_id uuid UNIQUE REFERENCES wallet_transactions,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 cancelled_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
