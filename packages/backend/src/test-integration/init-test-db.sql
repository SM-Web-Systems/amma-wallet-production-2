-- init-test-db.sql — Docker entrypoint init script for integration test database.
-- Phase 5.2 (P52-02): Creates a restricted test role and grants necessary privileges.
--
-- This runs once when the container is first created.
-- The postgres superuser creates the restricted role and test database.
--
-- The test harness then connects as stellarwallet_test (non-superuser)
-- and the provisioning script writes the trusted marker.

-- Create restricted test role (NOT a superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stellarwallet_test') THEN
    CREATE ROLE stellarwallet_test WITH LOGIN PASSWORD 'test_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Grant full access to the test database (but not to other databases)
GRANT ALL PRIVILEGES ON DATABASE stellarwallet_test TO stellarwallet_test;

-- Grant schema usage and table creation
GRANT ALL ON SCHEMA public TO stellarwallet_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO stellarwallet_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO stellarwallet_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO stellarwallet_test;
