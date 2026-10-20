export const MIGRATION_V7_SQL = `
-- The project Function role may access only the overlay tables used by the
-- auth-server runtime. GoTrue auth schema tables remain inaccessible and are
-- reached through /auth/v1.
DO $$
DECLARE
  project_role TEXT := 'role_' || regexp_replace(current_database(), '^supa_', '');
  table_name TEXT;
  select_insert_update_delete_tables TEXT[] := ARRAY[
    'api_resources',
    'scopes',
    'application_sign_in_experience',
    'organization_templates',
    'organization_template_instantiations',
    'enterprise_sso_config',
    'tenant_configs',
    'provisioning_records'
  ];
  select_insert_update_tables TEXT[] := ARRAY[
    'sign_in_experience',
    'connectors',
    'connector_factories',
    'application_consent_settings',
    'security_config'
  ];
  select_insert_delete_tables TEXT[] := ARRAY[
    'application_bindings'
  ];
  read_write_tables TEXT[] := ARRAY[
    'account_provisioning_records'
  ];
  select_insert_tables TEXT[] := ARRAY[
    'api_version_log'
  ];
  insert_only_tables TEXT[] := ARRAY[
    'oauth_consent_decisions'
  ];
  read_only_tables TEXT[] := ARRAY[
    'user_consents'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = project_role) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA supaoauth TO %I', project_role);

    -- Remove grants left by the historical V7 implementation. This keeps the
    -- repair idempotent and prevents retired or future objects from inheriting
    -- access through the old default privileges.
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA supaoauth FROM %I', project_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA supaoauth FROM %I', project_role);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA supaoauth FROM %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth REVOKE ALL PRIVILEGES ON TABLES FROM %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I', project_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA supaoauth REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I', project_role);

    FOREACH table_name IN ARRAY select_insert_update_delete_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY select_insert_update_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY select_insert_delete_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, DELETE ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    -- Account claiming reads the encrypted initial password in the Function,
    -- decrypts it there, and uses full-row RETURNING for its state machine.
    -- Keep this as an explicit table-level exception until that flow is moved
    -- behind a SECURITY DEFINER function boundary.
    FOREACH table_name IN ARRAY read_write_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY select_insert_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY insert_only_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT INSERT ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY read_only_tables LOOP
      IF to_regclass(format('supaoauth.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT ON TABLE supaoauth.%I TO %I',
          table_name,
          project_role
        );
      END IF;
    END LOOP;
  END IF;
END $$;
`;
