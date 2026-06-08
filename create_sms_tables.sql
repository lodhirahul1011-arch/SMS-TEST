-- Run this script in Supabase SQL editor or via psql to create required SMS tables.

CREATE TABLE IF NOT EXISTS sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  message text,
  sender_id text,
  button_clicked text,
  order_id text,
  awb text,
  otp text,
  valid_till text,
  status text DEFAULT 'pending',
  provider_response jsonb,
  message_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text,
  sender_id text DEFAULT 'GNETRA',
  template_id text,
  base_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Public can view SMS logs"
  ON sms_logs FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Public can insert SMS logs"
  ON sms_logs FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Public can update SMS logs"
  ON sms_logs FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Public can view SMS settings"
  ON sms_settings FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Public can insert SMS settings"
  ON sms_settings FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Public can update SMS settings"
  ON sms_settings FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs(created_at DESC);
