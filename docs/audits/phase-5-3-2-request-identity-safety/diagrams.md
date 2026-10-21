# Phase 5.3.2 — Mermaid Diagrams

## Diagram 1 — A → B → A Request Race

```mermaid
sequenceDiagram
    participant Admin
    participant Component as AdminTenantDetail
    participant GenRef as generationRef
    participant Server

    Admin->>Component: Open Tenant A
    Component->>GenRef: gen = 1
    Component->>Server: A1: GET /tenants/A/billing (captures gen=1)
    
    Admin->>Component: Navigate → Tenant B
    Component->>GenRef: gen = 2
    Component->>Server: B1: GET /tenants/B/billing (captures gen=2)
    Server-->>Component: B1 response (gen check: 2===2 ✓)
    Component->>Component: Display Tenant B data

    Admin->>Component: Navigate → Tenant A
    Component->>GenRef: gen = 3
    Component->>Server: A2: GET /tenants/A/billing (captures gen=3)
    
    Server-->>Component: A2 response (gen check: 3===3 ✓)
    Component->>Component: Display Tenant A (newer data)

    Server-->>Component: A1 response (STALE — gen check: 1≠3 ✗)
    Note over Component: A1 DISCARDED — generation mismatch
    Component->>Component: Tenant A newer data preserved
```

## Diagram 2 — Request Identity Lifecycle

```mermaid
flowchart LR
    subgraph "Request Context"
        TID[Tenant ID<br/>useParams → id]
        AID[Admin ID<br/>getAdminInfo → adminId]
        TOK[Session Token<br/>aw_admin_token]
        GEN[Generation<br/>generationRef++]
    end

    subgraph "Request Creation"
        CAP[Capture at start:<br/>gen = generationRef.current<br/>capturedToken = sessionStorage token]
    end

    subgraph "After Each Await"
        CHK{gen === generationRef.current?}
        CHK -->|No| DISC[Discard stale response]
        CHK -->|Yes| PROC[Process response]
    end

    subgraph "On 401"
        TOK_CHK{capturedToken === current token?}
        TOK_CHK -->|No| SKIP[Skip logout<br/>stale session]
        TOK_CHK -->|Yes| LOGOUT[Execute logout<br/>current session expired]
    end

    TID --> GEN
    GEN --> CAP
    TOK --> CAP
    CAP --> CHK
    PROC --> TOK_CHK
```

## Diagram 3 — Financial Result Persistence

```mermaid
sequenceDiagram
    participant Handler as handlePostCredit
    participant Storage as safeSaveCreditOp
    participant SS as sessionStorage

    Note over Handler: Credit POST in-flight

    Handler->>Storage: Write COMMITTED (key=X, eventId=42)
    Storage->>SS: Read existing for admin_1/tenant_1
    SS-->>Storage: null (no existing)
    Storage->>SS: Write COMMITTED ✓
    
    Note over Handler: Late retry response arrives with UNKNOWN

    Handler->>Storage: Write UNKNOWN (key=X)
    Storage->>SS: Read existing for admin_1/tenant_1
    SS-->>Storage: {key=X, state=COMMITTED, eventId=42}
    Storage->>Storage: Check: UNKNOWN(3) < COMMITTED(5)
    Note over Storage: REJECTED — would downgrade terminal state
    Storage-->>Handler: return false
    
    Note over SS: COMMITTED preserved with eventId=42

    Note over Handler: Different operation tries to overwrite

    Handler->>Storage: Write UNKNOWN (key=Y)
    Storage->>SS: Read existing for admin_1/tenant_1
    SS-->>Storage: {key=X, state=COMMITTED}
    Storage->>Storage: key Y ≠ key X, existing prec(5) ≥ 4
    Note over Storage: REJECTED — terminal state from different op
    Storage-->>Handler: return false
```

## Diagram 4 — Stale HTTP 401

```mermaid
sequenceDiagram
    participant AdminA as Admin A
    participant Component as AdminTenantDetail
    participant SS as sessionStorage
    participant Server

    AdminA->>Component: Start billing request
    Component->>SS: capturedToken = "token-A"
    Component->>Server: GET /billing (Authorization: Bearer token-A)
    
    AdminA->>Component: Logs out
    Component->>SS: Remove token-A
    
    Note over SS: Admin B logs in
    SS->>SS: aw_admin_token = "token-B"
    SS->>SS: aw_admin_info = {id: 2, ...}

    Server-->>Component: 401 (token-A expired)
    
    Component->>Component: safeLogout("token-A")
    Component->>SS: currentToken = "token-B"
    Component->>Component: "token-A" ≠ "token-B"
    Note over Component: SKIP logout — stale session
    
    Note over SS: Admin B's token-B preserved ✓
    Note over SS: Admin B remains logged in ✓
```

## Diagram 5 — TDD and Verification Loop

```mermaid
flowchart TD
    A[Phase A: Assess source<br/>Trace all async paths] --> B[Phase B: Specify invariants<br/>CTX-01..05, FIN-01..10]
    B --> C[Write failing regression tests<br/>17 tests, 11 fail against baseline]
    C --> D[Implement minimal correction<br/>generationRef + safeLogout + safeSaveCreditOp]
    D --> E[Run targeted tests<br/>17/17 P532 tests pass]
    E --> F{All pass?}
    F -- No --> G[Systematic debugging<br/>Trace generation/token flow]
    G --> D
    F -- Yes --> H[Run full regression suites<br/>150 frontend + 592 backend]
    H --> I[Independent code review<br/>12 questions examined]
    I --> J{Approved?}
    J -- No --> K[Fix findings<br/>R01: gen check after res.json<br/>R02: update idRef comment]
    K --> E
    J -- Yes --> L[Update docs and commit<br/>Specs, diagrams, tracker]
```

## Diagram 6 — State Precedence for safeSaveCreditOp

```mermaid
stateDiagram-v2
    [*] --> CONFIRMED: handleCreditClick<br/>(generates UUID)
    CONFIRMED --> SUBMITTING: handlePostCredit<br/>(user action, unconditional)
    SUBMITTING --> COMMITTED: HTTP 200<br/>(safeSaveCreditOp, prec=5)
    SUBMITTING --> REJECTED: HTTP 4xx<br/>(safeSaveCreditOp, prec=4)
    SUBMITTING --> UNKNOWN: Network error / 5xx<br/>(safeSaveCreditOp, prec=3)
    UNKNOWN --> SUBMITTING: Retry<br/>(user action, unconditional)
    UNKNOWN --> COMMITTED: Reconciliation<br/>(safeSaveCreditOp, prec=5)
    
    note right of COMMITTED: Terminal — cannot be downgraded
    note right of REJECTED: Terminal — cannot be downgraded
    note left of UNKNOWN: Late UNKNOWN cannot<br/>overwrite COMMITTED
```
