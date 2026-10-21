# Phase 5.3.5 — Mermaid Diagrams

## Diagram A: COMMITTED evidence protected from delayed UNKNOWN (R01)

```mermaid
sequenceDiagram
    participant Server
    participant FetchA as Fetch (UUID-A)
    participant SCE as saveConflictEvidence
    participant SS as sessionStorage
    
    Note over FetchA: UUID-A response arrives (stale)
    Note over FetchA: safeSaveCreditOp rejects (UUID-B active)
    
    FetchA->>SCE: save({state: COMMITTED, eventId: 42})
    SCE->>SS: Check existing record for UUID-A
    SS-->>SCE: (none)
    SCE->>SS: Write COMMITTED (eventId: 42)
    SCE-->>FetchA: true (saved)
    
    Note over FetchA: Delayed network error handler fires
    FetchA->>SCE: save({state: UNKNOWN, eventId: undefined})
    SCE->>SS: Check existing record for UUID-A
    SS-->>SCE: COMMITTED (prec=5)
    Note over SCE: Incoming UNKNOWN (prec=3) < COMMITTED (prec=5)
    SCE-->>FetchA: true (existing evidence protected)
    
    Note over SS: COMMITTED (eventId: 42) remains intact
```

## Diagram B: Same-admin session S1 → S2 during res.json() (R02)

```mermaid
sequenceDiagram
    participant Admin as Admin A (id=1)
    participant UI as React UI
    participant Fetch as handlePostCredit
    participant Auth as sessionStorage
    
    Admin->>UI: Submit credit (session S1)
    UI->>Fetch: Start POST (gen=5, token=S1, adminId=1)
    Fetch->>Auth: adminFetch (Bearer S1)
    
    Note over Fetch: Response headers arrive (200 OK)
    Fetch->>Fetch: isFinStale()? gen=5==5, id=1==1 → false
    Note over Fetch: await res.json() begins
    
    Admin->>Auth: Logout (clear S1)
    Admin->>Auth: Login (set S2, same id=1)
    
    Note over Fetch: res.json() resolves
    
    rect rgb(255, 200, 200)
        Note over Fetch: P534 BASELINE: isFinStale() → false (no token check)
        Fetch->>UI: setCreditOp(COMMITTED) ← STALE UPDATE to S2's UI
    end
    
    rect rgb(200, 255, 200)
        Note over Fetch: P535 FIX: isFinStale() checks capturedToken !== current
        Note over Fetch: S1 !== S2 → true (stale)
        Fetch->>Auth: safePersistWithConflict (evidence preserved)
        Note over Fetch: return — UI NOT updated
    end
```

## Diagram C: Conditional financial persistence decision tree (R03)

```mermaid
flowchart TD
    A[Financial result arrives] --> B{safeSaveCreditOp<br/>accepted?}
    
    B -- Yes --> C[Active slot updated<br/>Return: true]
    
    B -- No --> D{State is COMMITTED<br/>or UNKNOWN?}
    
    D -- No --> E[No evidence to preserve<br/>Return: false]
    
    D -- Yes --> F[saveConflictEvidence]
    
    F --> G{Existing conflict<br/>record?}
    
    G -- No --> H{sessionStorage<br/>write succeeds?}
    
    G -- Yes --> I{Incoming precedence<br/>>= existing?}
    
    I -- No --> J[Downgrade rejected<br/>Existing evidence safe<br/>Return: true]
    
    I -- Yes --> K{Equal state?<br/>Check immutable fields}
    
    K -- Conflict --> L[Reject conflicting write<br/>Existing evidence safe<br/>Return: true]
    
    K -- Compatible --> H
    
    H -- Yes --> M[Conflict evidence saved<br/>Return: true]
    
    H -- No --> N{Context stale?}
    
    N -- Yes --> O[Cannot surface warning<br/>Document limitation<br/>Return: false]
    
    N -- No --> P[Surface warning to admin<br/>with idempotency key<br/>Return: false]
```
