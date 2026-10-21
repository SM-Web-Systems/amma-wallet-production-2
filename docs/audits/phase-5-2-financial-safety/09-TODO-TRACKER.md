# 09-TODO-TRACKER: Phase 5.2 Progress

All items completed. This tracker was maintained during development and
reflects the final state.

## Batch A: Database Test Isolation (P52-02) — COMPLETE

- [x] Remove `postgres` from ALLOWED_TEST_ROLES
- [x] Add `aw_test_runner` restricted role
- [x] Add superuser detection in `verify()`
- [x] Add provisioning nonce verification
- [x] Add `verifyDatabaseUrlAlignment()`
- [x] Gate all seed operations behind `ensureVerifiedTestDb()`
- [x] Create `provision-test-db.ts`
- [x] Create `init-test-db.sql`
- [x] Create `docker-compose.test-db.yml`
- [x] Update `.env.integration` with new role
- [x] Add `test:provision-db` and `test:integration` scripts
- [x] Update all integration test files with `verify()` calls
- [x] 29 db-safety tests pass

## Batch B1: Credit State Machine (P52-01) — COMPLETE

- [x] Define CreditOperation interface with 5 states
- [x] Implement IDLE → CONFIRMED → SUBMITTING → COMMITTED flow
- [x] Implement UNKNOWN state with reconciliation
- [x] Implement REJECTED state with acknowledgment
- [x] Lock inputs when any operation exists
- [x] Add reconciliation endpoint (GET /credit-status)
- [x] Persist state to sessionStorage at every transition
- [x] Restore state from sessionStorage on page load
- [x] 12 reconciliation endpoint integration tests pass

## Batch B2: Admin Scoping (P52-04) — COMPLETE

- [x] Storage key format: `aw_pending_credit_{adminId}_{tenantId}`
- [x] Validate adminId on load
- [x] Validate tenantId on load
- [x] Corrupted storage returns null
- [x] Extract storage functions to `credit-op-storage.ts`
- [x] 21 storage scoping tests pass

## Batch C: Deterministic 23505 (P52-03) — COMPLETE

- [x] Pre-insert strategy: direct DB insert + route call
- [x] Verify duplicate:true response
- [x] Verify exactly-one billing event
- [x] Verify fingerprint mismatch → 409
- [x] Verify Drizzle error unwrapping (err.cause)
- [x] Verify reconciliation finds pre-inserted event
- [x] 5 deterministic 23505 tests pass

## Batch D: Migration Safety (P52-05/P52-06) — COMPLETE

- [x] Fix Step 1 "no lock" claim → AccessExclusiveLock
- [x] Fix rollback: add CONCURRENTLY restriction note
- [x] Fix rollback: add audit data destruction warning
- [x] Expand Step 2 comment with lock type and restrictions
- [x] Update runbook Section 8: stellarwallet_test → aw_test_runner
- [x] Update runbook Section 10: add sign convention note

## Batch E: Full Verification (P52-07) — COMPLETE

- [x] Backend unit tests: 592/592 pass
- [x] Frontend unit tests: 114/114 pass
- [x] Frontend TS compilation: 0 errors
- [x] Backend TS compilation: 0 new errors (19 pre-existing)
- [x] ESLint: 0 errors on modified files
- [x] Updated 2 frontend test assertions for new UI text

## Documentation — COMPLETE

- [x] 00-BASELINE.md
- [x] 01-P52-01-CREDIT-STATE-MACHINE.md
- [x] 02-P52-02-DATABASE-ISOLATION.md
- [x] 03-P52-03-DETERMINISTIC-23505.md
- [x] 04-P52-04-ADMIN-SCOPING.md
- [x] 05-P52-05-MIGRATION-CORRECTIONS.md
- [x] 06-P52-06-SQL-DOCUMENTATION.md
- [x] 07-P52-07-VERIFICATION-RESULTS.md
- [x] 08-MERMAID-DIAGRAMS.md
- [x] 09-TODO-TRACKER.md
- [x] 10-GIT-COMPARISON.md
- [x] 11-REVIEW-REQUEST.md
- [x] 12-FINAL-ASSESSMENT.md
