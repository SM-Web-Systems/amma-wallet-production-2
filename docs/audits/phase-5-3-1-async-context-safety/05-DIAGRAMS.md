# 05 — Diagrams

## Diagram 1: Current Defect — Stale Response Overwrites State

```mermaid
sequenceDiagram
    participant Admin
    participant Component as AdminTenantDetail
    participant API as Backend API
    participant State as React State

    Admin->>Component: View tenant A
    Component->>API: GET /tenants/A/billing
    Note over Component: load() captures id="A"

    Admin->>Component: Navigate to tenant B
    Note over Component: useEffect([id]) fires
    Component->>State: setCreditOp(null) — clear stale
    Component->>API: GET /tenants/B/billing
    Note over Component: NEW load() captures id="B"

    API-->>Component: Response for tenant A arrives
    Component->>State: setData(tenantA_data)
    Note over State: ⚠️ Tenant B display now shows tenant A data

    API-->>Component: Response for tenant B arrives
    Component->>State: setData(tenantB_data)
    Note over State: Corrected — but briefly showed wrong data
```

## Diagram 2: Current Defect — Credit Response on Wrong Tenant

```mermaid
sequenceDiagram
    participant Admin
    participant Component as AdminTenantDetail
    participant API as Backend API
    participant Storage as sessionStorage
    participant State as React State

    Admin->>Component: Submit credit for tenant A
    Component->>API: POST /tenants/A/credit
    Note over Component: handlePostCredit captures id="A", creditOp={tenantId:"A"}

    Admin->>Component: Navigate to tenant B
    Note over Component: useEffect([id]) fires
    Component->>State: setCreditOp(null) — clear

    API-->>Component: 200 OK (credit committed for tenant A)
    Component->>Storage: saveCreditOp({...state:"COMMITTED", tenantId:"A"})
    Note over Storage: ✅ Correct — scoped by (adminId, tenantId)
    Component->>State: setCreditOp({...state:"COMMITTED", tenantId:"A"})
    Note over State: ⚠️ Tenant B shows "Credit posted successfully" for tenant A
    Component->>API: GET /tenants/A/billing (via captured load)
    Note over State: ⚠️ Tenant B display gets tenant A billing data
```

## Diagram 3: Fixed Behavior — Context Ref Guard

```mermaid
sequenceDiagram
    participant Admin
    participant Component as AdminTenantDetail
    participant API as Backend API
    participant Ref as idRef
    participant Storage as sessionStorage
    participant State as React State

    Admin->>Component: Submit credit for tenant A
    Component->>API: POST /tenants/A/credit
    Note over Component: handlePostCredit captures id="A"
    Ref->>Ref: idRef.current = "A"

    Admin->>Component: Navigate to tenant B
    Note over Component: useEffect([id]) fires
    Ref->>Ref: idRef.current = "B"
    Component->>State: setCreditOp(null)

    API-->>Component: 200 OK (credit committed for tenant A)
    Component->>Storage: saveCreditOp({...state:"COMMITTED"})
    Note over Storage: ✅ Always persisted (correctly scoped)
    Component->>Component: Check: idRef.current("B") !== id("A")
    Note over Component: ✅ SKIP setCreditOp — context changed
    Note over Component: ✅ SKIP load() — wrong tenant
```

## Diagram 4: State Machine (Unchanged from P53)

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CONFIRMED: handleCreditClick (generate UUID)
    CONFIRMED --> IDLE: handleDiscardConfirmed
    CONFIRMED --> SUBMITTING: handlePostCredit
    UNKNOWN --> SUBMITTING: handlePostCredit (retry)
    SUBMITTING --> COMMITTED: HTTP 200
    SUBMITTING --> REJECTED: HTTP 4xx
    SUBMITTING --> UNKNOWN: HTTP 5xx / network error
    UNKNOWN --> COMMITTED: handleCheckStatus (committed)
    UNKNOWN --> UNKNOWN: handleCheckStatus (not_found)
    COMMITTED --> IDLE: handleAcknowledge
    REJECTED --> IDLE: handleAcknowledge

    note right of UNKNOWN
        P53-R01 fix: after await,
        state writes guarded by
        idRef.current === id
    end note
```

## Diagram 5: Test Pattern — Same-Component Navigation with Deferred Promise

```mermaid
sequenceDiagram
    participant Test
    participant MSW
    participant Component as AdminTenantDetail
    participant State as React State

    Test->>MSW: Install deferred handler for /tenants/A/credit
    Test->>Component: Render at /admin/tenants/A
    Test->>Component: Enter amount, confirm, submit
    Component->>MSW: POST /tenants/A/credit
    Note over MSW: Request held — deferred promise pending

    Test->>Component: Navigate to /admin/tenants/B (same MemoryRouter)
    Note over Component: id changes, useEffect fires
    Component->>State: setCreditOp(null)

    Test->>MSW: Resolve deferred promise (200 OK)
    MSW-->>Component: Response for tenant A

    Test->>Test: Assert: tenant B display NOT corrupted
    Test->>Test: Assert: no "Credit posted" banner visible
    Test->>Test: Assert: tenant A storage correctly updated
```
