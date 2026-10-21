# 08-MERMAID-DIAGRAMS: Phase 5.2 Visual Documentation

## 1. Credit Operation State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CONFIRMED : User clicks "Post credit"\n(generates UUID key)
    CONFIRMED --> SUBMITTING : User clicks "Post credit"\nin confirmation dialog
    CONFIRMED --> IDLE : User clicks "Discard\nand start fresh"
    SUBMITTING --> COMMITTED : HTTP 200
    SUBMITTING --> UNKNOWN : Network error / timeout / 5xx
    SUBMITTING --> REJECTED : HTTP 4xx (except 401)
    UNKNOWN --> COMMITTED : Reconciliation confirms committed
    UNKNOWN --> REJECTED : Reconciliation confirms not_found
    UNKNOWN --> SUBMITTING : User clicks "Retry submission"
    COMMITTED --> IDLE : User clicks "Post another credit"
    REJECTED --> IDLE : User clicks "Try a new credit"
```

## 2. sessionStorage Scoping

```mermaid
graph TD
    A[sessionStorage key] --> B["aw_pending_credit_{adminId}_{tenantId}"]
    B --> C{loadCreditOp validates}
    C -->|adminId matches| D[Return stored op]
    C -->|adminId mismatch| E[Return null]
    C -->|tenantId mismatch| E
    C -->|invalid JSON| E
    C -->|missing fields| E
```

## 3. Reconciliation Flow

```mermaid
sequenceDiagram
    participant UI as Admin UI
    participant API as GET /credit-status
    participant DB as billing_events

    UI->>API: GET /credit-status?idempotency_key=uuid
    API->>DB: SELECT WHERE tenantId AND idempotencyKey
    alt Event found
        DB-->>API: billing event row
        API-->>UI: { status: "committed", billingEventId, amountXlm }
        UI->>UI: UNKNOWN → COMMITTED
    else Event not found
        DB-->>API: empty result
        API-->>UI: { status: "not_found" }
        UI->>UI: UNKNOWN → REJECTED
    end
```

## 4. 23505 Recovery Path

```mermaid
sequenceDiagram
    participant Route as POST /credit
    participant TX as db.transaction
    participant PG as PostgreSQL
    participant Drizzle as Drizzle ORM

    Route->>TX: writeBillingCredit(key)
    TX->>PG: INSERT billing_event
    PG-->>Drizzle: ERROR 23505 unique_violation
    Drizzle-->>TX: throw { cause: { code: "23505", constraint_name: "uq_billing_credit_idempotency" } }
    TX-->>Route: catch(err)
    Route->>Route: Unwrap: pgError = err.cause ?? err
    Route->>Route: Check pgCode === "23505"
    Route->>Route: Check constraint === "uq_billing_credit_idempotency"
    Route->>PG: SELECT committed event by key
    PG-->>Route: committed event
    Route->>Route: validateIdempotencyFingerprint
    Route-->>Route: Return { duplicate: true, billingEventId }
```

## 5. Test Database Isolation Architecture

```mermaid
graph TB
    subgraph "Docker Container (port 15432)"
        PG[PostgreSQL 16]
        SUPER[stellarwallet_test<br/>SUPERUSER]
        RUNNER["aw_test_runner<br/>NOSUPERUSER<br/>NOCREATEDB<br/>NOCREATEROLE"]
    end

    subgraph "Test Lifecycle"
        PROV[provision-test-db.ts] -->|"Creates marker<br/>with nonce"| MARKER["aw_test_harness_marker<br/>nonce: p52-disposable-verified"]
        TEST[Integration Tests] -->|"verify() checks"| CHECK{Superuser?<br/>Marker?<br/>Nonce?}
        CHECK -->|Pass| RUN[Run tests]
        CHECK -->|Fail| ABORT[Abort]
    end

    RUNNER --> PG
    PROV -->|"Connects as"| RUNNER
    TEST -->|"Connects as"| RUNNER
```

## 6. Database URL Validation Chain

```mermaid
flowchart TD
    URL[TEST_DATABASE_URL] --> PARSE[parseTestDbUrl]
    PARSE --> HOST{Host in<br/>allowed list?}
    HOST -->|localhost, 127.0.0.1, ::1| PORT{Port in<br/>allowed list?}
    HOST -->|other| BLOCK1[SAFETY BLOCK]
    PORT -->|15432, 15433| DB{DB name in<br/>allowed list?}
    PORT -->|5432, other| BLOCK2[SAFETY BLOCK]
    DB -->|stellarwallet_test| PROD{Not in<br/>production names?}
    DB -->|other allowed| PROD
    DB -->|stellarwallet, amma, etc| BLOCK3[SAFETY BLOCK]
    PROD -->|Pass| ROLE{Role in<br/>allowed list?}
    PROD -->|Match| BLOCK4[SAFETY BLOCK]
    ROLE -->|stellarwallet_test,<br/>amma_test, test,<br/>aw_test_runner| ALIGN[verifyDatabaseUrlAlignment]
    ROLE -->|postgres, other| BLOCK5[SAFETY BLOCK]
    ALIGN -->|Match| ACCEPT[✓ Accepted]
    ALIGN -->|Mismatch| BLOCK6[SAFETY BLOCK]
```

## 7. Credit Posting End-to-End Flow

```mermaid
sequenceDiagram
    participant Admin as Admin Browser
    participant SS as sessionStorage
    participant API as POST /credit
    participant TX as DB Transaction
    participant PG as PostgreSQL

    Admin->>Admin: Enter amount, type, notes
    Admin->>Admin: Click "Post credit"
    Admin->>SS: Save { state: CONFIRMED, key: uuid, adminId, tenantId }
    Admin->>Admin: Confirmation dialog opens
    Admin->>Admin: Click "Post credit" (in dialog)
    Admin->>SS: Save { state: SUBMITTING }
    Admin->>API: POST /credit { key, amount, type }
    API->>TX: writeBillingCredit
    TX->>PG: SELECT existing by key
    alt No existing event
        TX->>PG: INSERT billing_event
        TX->>PG: UPDATE tenant balance
        PG-->>TX: committed
        TX-->>API: { billingEventId, newBalance }
    else Existing event found
        TX-->>API: { billingEventId, newBalance, duplicate: true }
    end
    API-->>Admin: HTTP 200
    Admin->>SS: Save { state: COMMITTED, committedEventId }
    Admin->>Admin: Show success + acknowledgment button
```

## 8. Phase 5.2 File Change Map

```mermaid
graph LR
    subgraph "Backend"
        A[admin.ts] -->|"+ reconciliation endpoint"| A
        B[db-harness.ts] -->|"+ role restriction<br/>+ nonce verification<br/>+ superuser detection"| B
        C[db-safety.test.ts] -->|"29 structural tests"| C
        D[api-credit-concurrency.test.ts] -->|"+ 12 reconciliation<br/>+ 5 deterministic 23505"| D
        E[provision-test-db.ts] -->|"NEW"| E
        F[init-test-db.sql] -->|"NEW"| F
        G[docker-compose.test-db.yml] -->|"NEW"| G
        H[001_add_idempotency_key.sql] -->|"Fixed comments"| H
    end

    subgraph "Frontend"
        I[AdminTenantDetail.tsx] -->|"State machine rewrite"| I
        J[credit-op-storage.ts] -->|"NEW: extracted storage"| J
        K[credit-op-storage.test.ts] -->|"NEW: 21 tests"| K
        L[AdminTenantDetail.test.tsx] -->|"Updated assertions"| L
    end

    subgraph "Docs"
        M[05-MIGRATION-RUNBOOK.md] -->|"Fixed role ref + sign note"| M
    end
```
