# Phase 5.3.3 — Mermaid Diagrams

## Diagram 1 — Different-UUID Overwrite Race

```mermaid
sequenceDiagram
    participant Admin
    participant UI as React State
    participant Storage as sessionStorage
    participant Server

    Note over Admin,Server: Op A (UUID-A) submitted
    Admin->>UI: Submit credit (UUID-A)
    UI->>Storage: saveCreditOp(UUID-A, SUBMITTING)
    UI->>Server: POST /credit (UUID-A)

    Note over Admin,Server: Server 500 → UNKNOWN
    Server-->>UI: 500 Internal Error
    UI->>Storage: safeSaveCreditOp(UUID-A, UNKNOWN) ✓
    UI->>UI: setCreditOp(UNKNOWN)

    Note over Admin,Server: Admin reconciles
    Admin->>UI: Click "Check credit status"
    UI->>Server: GET /credit-status?key=UUID-A

    Note over Admin,Server: Admin navigates away before response
    Admin->>UI: Navigate to tenant 99
    Note over UI: gen increments

    Admin->>UI: Navigate back to tenant 42
    Note over UI: gen increments again
    Storage-->>UI: Restore UUID-A UNKNOWN

    Note over Admin,Server: Admin acknowledges and starts new op
    Admin->>UI: Acknowledge → clear
    UI->>Storage: clearCreditOp() → empty
    Admin->>UI: Create op B (UUID-B)
    UI->>Storage: saveCreditOp(UUID-B, CONFIRMED)
    Admin->>UI: Submit op B
    UI->>Storage: saveCreditOp(UUID-B, SUBMITTING)
    UI->>Server: POST /credit (UUID-B)

    Note over Admin,Server: DEFECT: Stale check-status resolves
    Server-->>UI: credit-status: "committed" (UUID-A)
    Note over UI: gen stale → stale path

    rect rgb(255, 200, 200)
        Note over UI,Storage: BASELINE BUG: UUID mismatch overwrite
        UI->>Storage: safeSaveCreditOp(UUID-A, COMMITTED)
        Note over Storage: existing: UUID-B SUBMITTING (prec 2 < 4)
        Note over Storage: OVERWRITTEN → UUID-A COMMITTED
    end

    Note over Admin,Server: UUID-B's POST response arrives
    Server-->>UI: 200 OK (UUID-B committed)
    UI->>Storage: safeSaveCreditOp(UUID-B, COMMITTED)
    Note over Storage: existing: UUID-A COMMITTED (prec 5, diff key)
    Note over Storage: REJECTED — UUID-B result LOST

    rect rgb(200, 255, 200)
        Note over UI,Storage: P533-01 FIX: Strict UUID matching
        UI->>Storage: safeSaveCreditOp(UUID-A, COMMITTED)
        Note over Storage: existing: UUID-B SUBMITTING (different key)
        Note over Storage: REJECTED — UUID-B protected
    end
```

## Diagram 2 — Financial Operation Persistence Rules

```mermaid
stateDiagram-v2
    direction LR

    [*] --> empty: No record

    empty --> CONFIRMED: save (new op)
    empty --> COMMITTED: save (stale evidence)

    state "Same UUID" as same {
        CONFIRMED --> SUBMITTING: upgrade ✓
        SUBMITTING --> UNKNOWN: upgrade ✓
        SUBMITTING --> REJECTED: upgrade ✓
        SUBMITTING --> COMMITTED: upgrade ✓
        UNKNOWN --> COMMITTED: upgrade ✓
        UNKNOWN --> UNKNOWN: equal ✓
        REJECTED --> COMMITTED: upgrade ✓
    }

    state "Same UUID (blocked)" as blocked {
        COMMITTED --> UNKNOWN: downgrade ✗
        COMMITTED --> REJECTED: downgrade ✗
        COMMITTED --> SUBMITTING: downgrade ✗
        COMMITTED --> CONFIRMED: downgrade ✗
        UNKNOWN --> SUBMITTING: downgrade ✗
        UNKNOWN --> CONFIRMED: downgrade ✗
        REJECTED --> UNKNOWN: downgrade ✗
    }

    state "Different UUID (all blocked)" as diffuuid {
        note left of diffuuid
            P533-01 FIX:
            ANY state → different UUID = REJECTED
            Regardless of precedence
        end note
    }

    CONFIRMED --> [*]: clearCreditOp (acknowledge)
    COMMITTED --> [*]: clearCreditOp (acknowledge)
    REJECTED --> [*]: clearCreditOp (acknowledge)
```

## Diagram 3 — React State and Storage Consistency

```mermaid
flowchart TD
    A[Async handler receives response] --> B{gen stale?}
    B -- Yes --> C[Stale path: safeSaveCreditOp only]
    C --> D{safeSaveCreditOp accepted?}
    D -- Yes --> E[Storage updated, React state NOT updated]
    D -- No --> F[Storage unchanged, React state NOT updated]

    B -- No --> G{Admin identity changed?}
    G -- Yes --> C

    G -- No --> H[safeSaveCreditOp with result]
    H --> I{safeSaveCreditOp accepted?}
    I -- Yes --> J[Storage updated]
    J --> K[setCreditOp — React state matches storage ✓]
    I -- No --> L[Storage unchanged]
    L --> M[React state NOT updated — matches storage ✓]

    style F fill:#fdd,stroke:#c00
    style M fill:#fdd,stroke:#c00
    style E fill:#ffd,stroke:#aa0
    style K fill:#dfd,stroke:#0a0
```

## Diagram 4 — Same-Route Overlapping Requests

```mermaid
sequenceDiagram
    participant User
    participant UI as React State
    participant Seq as loadSeqRef
    participant Server

    Note over User,Server: Both requests for same tenant (no navigation)

    User->>UI: Click Refresh
    UI->>Seq: ++loadSeqRef → seq=1
    UI->>Server: GET /billing (request A1, seq=1)

    User->>UI: Click Refresh again
    UI->>Seq: ++loadSeqRef → seq=2
    UI->>Server: GET /billing (request A2, seq=2)

    Note over Server: A2 resolves first (newer data)
    Server-->>UI: Response A2 (balance: 999)
    UI->>Seq: Check: seq(2) === loadSeqRef(2)? YES
    UI->>UI: setData(A2) — balance: 999 ✓

    Note over Server: A1 resolves last (older data)
    Server-->>UI: Response A1 (balance: 500)
    UI->>Seq: Check: seq(1) === loadSeqRef(2)? NO

    rect rgb(200, 255, 200)
        Note over UI: A1 DISCARDED — newer A2 data preserved
    end
```

## Diagram 5 — Administrator Switching

```mermaid
sequenceDiagram
    participant AdminA as Admin A
    participant AdminB as Admin B
    participant UI as React State
    participant Session as sessionStorage
    participant Server

    Note over AdminA,Server: Admin A viewing tenant 42

    AdminA->>UI: View tenant 42
    UI->>Session: Capture token=A, adminId=1
    UI->>Server: GET /billing (with token A)

    Note over AdminA,Server: Admin B logs in (no route change)
    AdminB->>Session: Set token=B, adminInfo={id:2}
    Note over UI: Route param unchanged, gen unchanged

    Note over Server: Admin A's response arrives
    Server-->>UI: 200 OK (billing data)

    UI->>Session: Check: capturedAdminId(1) === getAdminInfo().id(2)?

    rect rgb(200, 255, 200)
        Note over UI: NO — admin changed
        Note over UI: Response DISCARDED
        Note over UI: Admin B's view unchanged
    end

    Note over AdminB,Server: Admin B clicks Refresh
    AdminB->>UI: Click Refresh
    UI->>Session: Capture token=B, adminId=2
    UI->>Server: GET /billing (with token B)
    Server-->>UI: 200 OK (Admin B's data)
    UI->>Session: Check: capturedAdminId(2) === getAdminInfo().id(2)? YES
    UI->>UI: setData — Admin B's data displayed ✓
```

## Diagram 6 — Autonomous Verification Cycle

```mermaid
flowchart TD
    A[Assess actual source] --> B[Document root cause]
    B --> C[Write failing regression tests]
    C --> D[Implement minimal fix]
    D --> E[Run targeted tests]
    E --> F{Tests pass?}
    F -- No --> G[Systematic debugging]
    G --> D
    F -- Yes --> H[Run full safe regression]
    H --> I[Independent code review]
    I --> J{Review accepted?}
    J -- No --> D
    J -- Yes --> K[Update specifications and commit]
```
