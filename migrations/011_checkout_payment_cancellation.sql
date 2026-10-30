ALTER TABLE checkout_payments
 DROP CONSTRAINT IF EXISTS checkout_payments_status_check;

ALTER TABLE checkout_payments
 ADD CONSTRAINT checkout_payments_status_check
 CHECK (status IN ('awaiting_payment','simulated','legacy_untracked','refunded','cancelled'));
