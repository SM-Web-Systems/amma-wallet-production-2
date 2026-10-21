# LOW & INFO Findings Remediation Plan

Generated: 2026-09-02

## Finding Inventory

### Fix Now (7 findings)

| # | ID | System | Severity | Description | Files | Test Approach |
|---|---|---|---|---|---|---|
| 1 | FIND-006-A | AW | LOW | PIN parameter no guard before `decryptSecret` | `server.ts:1304,1557` | Existing wallet sign tests + new guard test |
| 2 | FIND-009-B | AW | LOW | Stellar client getters create new objects per call | `stellar-client.ts:45-51` | New unit test verifying same instance returned |
| 3 | FIND-015-A | AW | LOW | `parseFloat()` instead of `compareDecimalStrings()` in auto-suspension | `auto-suspension.ts:185,308` | Existing auto-suspension tests |
| 4 | FIND-010b | LMS | LOW | No timeout on Horizon fetch calls | `stellarPaymentMonitor.ts:105,128` | Existing monitor tests + new timeout test |
| 5 | FIND-024-07 | Infra | LOW | No SHA-256 sidecar for LMS backup | `backup_lms_db.sh` | Manual: run script, verify .sha256 file |
| 6 | FIND-026-04 | Infra | LOW | LMS healthcheck uses `nginx -t` not HTTP | `docker-compose.yml:133-148` | `docker inspect` healthcheck status |
| 7 | FIND-026-05 | Infra | LOW | MariaDB port 3306 exposed to host | `docker-compose.yml:69-88` | `docker port mariadb_server` |

### Document/Defer (3 findings)

| # | ID | System | Severity | Description | Rationale |
|---|---|---|---|---|---|
| 8 | FIND-007-A | AW | LOW | Trustline endpoint unauthenticated | Horizon is public; adding auth adds no security value |
| 9 | FIND-003b | LMS | LOW | Role in redirect URL fragment | Frontend derives role from JWT; URL role is cosmetic |
| 10 | FIND-006-B | AW | INFO | `pbkdf2Sync` blocks event loop | Rate limit 5/15min mitigates; async migration is high-effort low-reward |

## Batch Execution Order

### Batch 1: AmmaWallet Application Fixes
- FIND-006-A: Add `if (!pin)` guard returning 400 before `decryptSecret` calls
- FIND-009-B: Cache `stellar()` and `account()` return values in constructor
- FIND-015-A: Replace `parseFloat()` with `compareDecimalStrings()` in auto-suspension

### Batch 2: LMS + Infrastructure Fixes
- FIND-010b: Add AbortController with 30s timeout to both Horizon fetch calls
- FIND-024-07: Add `sha256sum` sidecar generation to LMS backup script
- FIND-026-04: Change LMS frontend healthcheck from `nginx -t` to `curl -f http://localhost/`
- FIND-026-05: Change MariaDB `ports` to `expose` (remove host binding)

### Batch 3: Document/Defer
- FIND-007-A, FIND-003b, FIND-006-B: Update FINDINGS.md with rationale

## Deployment Impact

- **Batch 1**: AmmaWallet backend rebuild + restart (`docker compose build amma-api && docker compose up -d --no-deps amma-api`)
- **Batch 2**: LMS containers + infra containers (`docker compose up -d --no-deps lms-api lms-frontend mariadb`)
- **Batch 3**: No deployment needed (documentation only)

## Rollback Strategy

- Each batch committed separately with descriptive message
- Git revert + container rebuild if any batch causes regression
- Pre-batch: verify test baseline passes
- Post-batch: run targeted tests + health checks

## Evidence Required

- Test output for each changed file
- `curl` health check of affected endpoints
- `docker ps` showing healthy containers
- Updated FINDINGS.md with commit SHAs
