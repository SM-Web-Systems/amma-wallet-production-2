# Phase 5.3.4 — Mermaid Diagrams

## Diagram 1 — Conflicting UUID Financial Response

```mermaid
sequenceDiagram
    participant Admin
    participant UI as React UI
    participant Handler as handlePostCredit
    participant Storage as sessionStorage
    participant Server

    Admin->>UI: Submit credit (UUID-A)
    UI->>Handler: handlePostCredit()
    Handler->>Storage: saveCreditOp(A, SUBMITTING)
    Handler->>Server: POST /credit (UUID-A)
    Note over Server: Processing...

    Admin->>UI: Navigate to Tenant B
    Note over UI: generationRef increments<br/>setCreditOp(null)

    Note over Storage: Boundary condition:<br/>UUID-B placed in A's slot<br/>(corruption/eviction/devtools)

    Server-->>Handler: 200 OK (UUID-A COMMITTED)
    Handler->>Handler: isFinStale() → true (stale path)
    Handler->>Storage: safeSaveCreditOp(A, COMMITTED)
    Storage-->>Handler: false (UUID-B in slot)

    alt Before P534-01 fix
        Note over Handler: Evidence LOST silently
        Handler->>Handler: return (no fallback)
    end

    alt After P534-01 fix
        Handler->>Storage: saveConflictEvidence(A, COMMITTED)
        Storage-->>Handler: true (saved under UUID-A key)
        Note over Storage: Active: UUID-B<br/>Conflict: UUID-A COMMITTED
    end

    Admin->>UI: Navigate back to Tenant A
    UI->>Storage: loadConflictEvidence(admin, tenant)
    UI->>Admin: Banner: "Previous operation UUID-A has confirmed outcome"
```

## Diagram 2 — Financial Evidence and Active Operation Separation

```mermaid
graph TB
    subgraph "sessionStorage (per tab)"
        subgraph "Active Operation Slot"
            AOS["aw_pending_credit_{admin}_{tenant}<br/>One per (admin, tenant) pair<br/>Current active operation"]
        end
        subgraph "Conflict Evidence Records"
            CE1["aw_credit_conflict_{admin}_{tenant}_{uuid-A}<br/>Preserved COMMITTED evidence"]
            CE2["aw_credit_conflict_{admin}_{tenant}_{uuid-X}<br/>Preserved UNKNOWN evidence"]
        end
    end

    subgraph "Server (authoritative)"
        LEDGER["billing_events table<br/>Authoritative financial record"]
        RECON["GET /credit-status?idempotency_key=<br/>Reconciliation endpoint"]
    end

    AOS -->|"safeSaveCreditOp: same UUID"| AOS
    AOS -.->|"safeSaveCreditOp: diff UUID → rejected"| CE1
    CE1 -->|"Admin uses UUID for reconciliation"| RECON
    RECON -->|"committed / not_found"| LEDGER

    style AOS fill:#e8f5e9,stroke:#4caf50
    style CE1 fill:#fff3e0,stroke:#ff9800
    style CE2 fill:#fff3e0,stroke:#ff9800
    style LEDGER fill:#e3f2fd,stroke:#2196f3
```

## Diagram 3 — Async Response-Body Race (P534-02)

```mermaid
sequenceDiagram
    participant Admin
    participant UI as React UI
    participant Handler as handlePostCredit
    participant Fetch as fetch()
    participant JSON as res.json()
    participant Refs as generationRef

    Admin->>UI: Submit credit (Tenant A)
    UI->>Handler: handlePostCredit()
    Handler->>Handler: capture gen = generationRef.current
    Handler->>Fetch: await adminFetch(POST)

    Fetch-->>Handler: Response headers (200 OK)
    Handler->>Handler: isFinStale() → false ✓

    Handler->>JSON: await res.json()
    Note over JSON: Body parsing...<br/>(network delay)

    Admin->>UI: Navigate to Tenant B
    Refs->>Refs: generationRef++

    JSON-->>Handler: { billingEventId: 42 }

    alt Before P534-02 fix
        Note over Handler: finStale still false!<br/>(computed before res.json)
        Handler->>UI: setCreditOp(COMMITTED)
        Note over UI: Tenant B shows<br/>Tenant A's COMMITTED ✗
    end

    alt After P534-02 fix
        Handler->>Handler: isFinStale() → true ✓
        Handler->>Handler: Persist evidence, skip UI update
        Note over UI: Tenant B unchanged ✓
    end
```

## Diagram 4 — Financial State Transitions

```mermaid
stateDiagram-v2
    [*] --> IDLE: No operation

    IDLE --> CONFIRMED: handleCreditClick()<br/>Generate UUID

    CONFIRMED --> SUBMITTING: handlePostCredit()<br/>Same UUID
    CONFIRMED --> IDLE: handleDiscardConfirmed()

    SUBMITTING --> COMMITTED: HTTP 200<br/>Same UUID, precedence ✓
    SUBMITTING --> REJECTED: HTTP 4xx<br/>Same UUID, precedence ✓
    SUBMITTING --> UNKNOWN: HTTP 5xx / Network error<br/>Same UUID, precedence ✓

    UNKNOWN --> SUBMITTING: Retry submission<br/>Same UUID
    UNKNOWN --> COMMITTED: Reconciliation confirms<br/>Same UUID, precedence ✓

    COMMITTED --> IDLE: handleAcknowledge()
    REJECTED --> IDLE: handleAcknowledge()

    state "Cross-UUID Protection" as cross {
        note left of cross
            safeSaveCreditOp rejects
            when existing.key ≠ op.key.
            
            P534-01: Rejected COMMITTED
            evidence → conflict record.
            
            COMMITTED ✗→ UNKNOWN (precedence)
            COMMITTED ✗→ REJECTED (precedence)
        end note
    }
```

## Diagram 5 — TDD Development Loop

```mermaid
flowchart TD
    A[Source assessment] --> B[Document invariants]
    B --> C[Write failing tests]
    C --> D[Implement minimal fix]
    D --> E[Run targeted tests]
    E --> F{All pass?}
    F -- No --> G[Systematic debugging]
    G --> D
    F -- Yes --> H[Run full regression]
    H --> I[Independent code review]
    I --> J{Findings resolved?}
    J -- No --> D
    J -- Yes --> K[Document evidence and commit]
```

## Diagram 6 — Context Revalidation Points

```mermaid
flowchart LR
    subgraph handlePostCredit
        A[Capture gen, adminId, token] --> B[await adminFetch]
        B --> C{isFinStale?}
        C -->|Yes| D[Stale path:<br/>persist evidence, return]
        C -->|No| E[Check 401]
        E --> F[await res.json]
        F --> G{isFinStale?}
        G -->|Yes| H[NEW: Late-stale path:<br/>persist evidence, return]
        G -->|No| I[Process result:<br/>update storage + UI]
    end

    subgraph handleCheckStatus
        J[Capture gen, adminId] --> K[await adminFetch]
        K --> L{reconStale?}
        L -->|Yes| M[Persist if committed, return]
        L -->|No| N[Check 401]
        N --> O[await res.json]
        O --> P{reconStale?}
        P -->|Yes| Q[Skip UI update]
        P -->|No| R[Process result]
    end

    style G fill:#fff3e0,stroke:#ff9800,stroke-width:3px
    style H fill:#fff3e0,stroke:#ff9800,stroke-width:3px
```
