# Expand-then-Deploy Migration Sequence

```mermaid
flowchart LR
    subgraph "Phase 1: Schema Expansion"
        M1["ALTER TABLE<br/>ADD COLUMN<br/>idempotency_key TEXT"] --> M2["CREATE UNIQUE INDEX<br/>CONCURRENTLY<br/>uq_billing_credit_idempotency"]
        M2 --> M3["Verify<br/>indisvalid = true"]
    end

    subgraph "Phase 2: Application Deploy"
        D1["Deploy backend<br/>with idempotency code"] --> D2["New credits populate<br/>idempotency_key"]
        D2 --> D3["Historical events<br/>keep NULL keys"]
    end

    M3 --> D1

    subgraph "Rollback (if needed)"
        R1["DROP INDEX CONCURRENTLY"] --> R2["ALTER TABLE DROP COLUMN"]
    end

    style M1 fill:#dbeafe
    style M2 fill:#dbeafe
    style D1 fill:#d1fae5
    style R1 fill:#fef3c7
    style R2 fill:#fef3c7
```

## Key Properties

- **Instant column add:** Nullable columns with no default don't rewrite the table
- **Non-blocking index:** `CONCURRENTLY` avoids write locks during build
- **Backward compatible:** Old app ignores the column; new app handles NULL keys
- **Partial index:** `WHERE idempotency_key IS NOT NULL` excludes historical events
