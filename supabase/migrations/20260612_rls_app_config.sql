-- Enable RLS on app_config so anon users cannot read Google tokens or write config
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read config
CREATE POLICY "authenticated read app_config"
  ON app_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated users can insert/update config
CREATE POLICY "authenticated write app_config"
  ON app_config
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated update app_config"
  ON app_config
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated delete app_config"
  ON app_config
  FOR DELETE
  TO authenticated
  USING (true);
