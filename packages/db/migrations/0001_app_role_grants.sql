-- Least privilege for the runtime role. The API connects as sm_app, which can read and write
-- rows but cannot create, alter or drop anything. Migrations run as the owner role.
-- Guarded so the migration also works where sm_app does not exist (local and test databases).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sm_app') THEN
    GRANT USAGE ON SCHEMA public TO sm_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sm_app;
  END IF;
END
$$;
