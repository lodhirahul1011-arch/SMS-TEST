ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS button_clicked text,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS awb text,
  ADD COLUMN IF NOT EXISTS otp text,
  ADD COLUMN IF NOT EXISTS valid_till text;
