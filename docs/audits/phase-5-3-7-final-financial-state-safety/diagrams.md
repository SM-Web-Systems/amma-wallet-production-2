# Phase 5.3.7 — Mermaid Diagrams

## Diagram 1 — Storage failure with active collision (P537-01)

```mermaid
flowchart TD
    A[UUID-A HTTP 200 COMMITTED] --> B{safeSaveCreditOp}
    B -->|UUID mismatch| C{saveConflictEvidence}
    C -->|QuotaExceededError| D[storage_failed]
    D --> E{BEFORE FIX}
    D --> F{AFTER FIX}
    E -->|setCreditOp A| G["React: UUID-A COMMITTED\nStorage: UUID-B\n⚠ DIVERGED"]
    F -->|refreshFromStorage| H["React: UUID-B from storage\n+ warning with UUID-A key"]

    style G fill:#f8d7da
    style H fill:#d4edda
```

## Diagram 2 — UUID-bound acknowledge/discard (P537-02)

```mermaid
flowchart TD
    A[User clicks Acknowledge/Discard] --> B[Read expectedKey from creditOp]
    B --> C[Read stored op from sessionStorage]
    C --> D{stored.key === expectedKey?}
    D -->|Match| E[clearCreditOp + setCreditOp null]
    D -->|Mismatch| F[Restore stored op into React]
    D -->|No stored op| E
    F --> G[Show actual active operation]

    style E fill:#d4edda
    style F fill:#fff3cd
```

## Diagram 3 — Session recovery after S1 discard (P537-03)

```mermaid
sequenceDiagram
    participant S1 as Session S1
    participant S2 as Session S2
    participant View as React View

    S1->>View: load() begins, setLoading(true)
    Note over View: S1 request in-flight

    S2->>View: Session replaced (new token)

    S1-->>View: Response arrives
    View->>View: isReadStale → true (token mismatch)
    View->>View: Discard S1 data

    Note over View: BEFORE FIX: finally skips setLoading(false)
    Note over View: Page stuck on "Loading billing data…"

    Note over View: AFTER FIX: finally always resets loading
    View->>View: setLoading(false), setError("Session changed")
    View->>View: Admin clicks Refresh or load() re-invoked
    S2->>View: Fresh billing data renders
```

## Diagram 4 — Conflict evidence validation outcomes (P537-04)

```mermaid
flowchart TD
    A[Incoming conflict evidence] --> B{Existing record?}
    B -->|No or malformed| C["written"]
    B -->|Valid existing| D{Immutable fields match?}
    D -->|Differ| E["identity_conflict"]
    D -->|Match| F{State precedence?}
    F -->|Incoming < Existing| G["existing_protected"]
    F -->|Incoming >= Existing| H{committedEventId conflict?}
    H -->|Conflicting IDs| E
    H -->|Compatible| C

    style C fill:#d4edda
    style E fill:#f8d7da
    style G fill:#fff3cd
```
