# 07-IMPLEMENTATION-PLAN: Phase 5.1 Remediation

---

## Execution Order

| Phase | Findings | Rationale |
|-------|----------|-----------|
| A | REV-03 | Test isolation must be established before running destructive DB tests |
| B | REV-07, REV-04, REV-02 | Backend financial integrity — fixes the core idempotency system |
| C | REV-01 | Frontend depends on backend being correct first |
| D | REV-06, REV-05 | Documentation and compatibility analysis — no code changes to core logic |
| E | All | Full test suite execution to verify no regressions |
| F | All | Documentation artifacts |
| G | All | Internal review cycle |
| H | All | Final verification table |
| I | All | Git handoff |

## Dependency Graph

```mermaid
flowchart LR
    A[REV-03: Test isolation] --> B1[REV-07: Constraint ID]
    A --> B2[REV-04: Bundle fingerprint]
    A --> B3[REV-02: API tests]
    B1 --> B3
    B2 --> B3
    B3 --> C[REV-01: Frontend persistence]
    B3 --> D1[REV-06: API compatibility]
    B3 --> D2[REV-05: Migration docs]
    C --> E[Test suite]
    D1 --> E
    D2 --> E
    E --> F[Documentation]
    F --> G[Review]
    G --> H[Verification]
    H --> I[Handoff]
```

## Commit Strategy

Each finding (or logical group) gets its own commit with:
- Descriptive commit message referencing finding ID(s)
- Test evidence in the commit
- No unrelated changes bundled
