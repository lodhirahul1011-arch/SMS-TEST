/*
  # Create SMS Notification Tables

  1. New Tables
    - `sms_logs`
      - `id` (uuid, primary key)
      - `number` (text, recipient phone number)
      - `message` (text, SMS content)
      - `sender_id` (text, sender identifier)
      - `status` (text, delivery status)
      - `provider_response` (jsonb, API response from SMS provider)
      - `message_id` (text, provider message ID)
      - `created_at` (timestamp)
    - `sms_settings`
      - `id` (uuid, primary key)
      - `api_key` (text, SMS API key)
      - `sender_id` (text, default sender ID)
      - `template_id` (text, SMS template ID)
      - `base_url` (text, SMS API base URL)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for public read/write (for demo purposes)
*/

-- Create sms_logs table
CREATE TABLE IF NOT EXISTS sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  message text,
  sender_id text,
  status text DEFAULT 'pending',
  provider_response jsonb,
  message_id text,
  created_at timestamptz DEFAULT now()
);

-- Create sms_settings table
CREATE TABLE IF NOT EXISTS sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text,
  sender_id text DEFAULT 'GNETRA',
  template_id text,
  base_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (demo purposes)
CREATE POLICY "Public can view SMS logs"
  ON sms_logs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Public can insert SMS logs"
  ON sms_logs FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update SMS logs"
  ON sms_logs FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can view SMS settings"
  ON sms_settings FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Public can insert SMS settings"
  ON sms_settings FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can update SMS settings"
  ON sms_settings FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs(created_at DESC);
