# Versioned Management API Contract

SupaOAuth Management API is versioned under `/v1`. Breaking behavior changes require a new API version or an explicit breaking-change entry in `supaoauth.api_version_log`.

## Error Envelope

New endpoints should return errors using this envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "request_id": "optional-request-id"
  }
}
```

Existing endpoints that still return plain text are compatibility debt and should be migrated without changing status semantics.

## Release Contract

- `bun run scripts/export-openapi.ts <file>` exports the current OpenAPI shape.
- `bun run release:gate` records OpenAPI and SupaCloud app manifest hashes into the release manifest.
- Breaking route changes must be recorded through `POST /v1/api-versions` with `change_type=breaking`.
- SDK releases must reference the same OpenAPI hash as the release manifest; SupaCloud deployments must reference the same SupaCloud app manifest hash.

## Compatibility Policy

- Additive fields and endpoints are allowed in `/v1`.
- Removing fields, changing status codes, changing auth requirements, or changing response envelopes is breaking.
- Deprecated endpoints must remain for at least one minor release window before removal.
