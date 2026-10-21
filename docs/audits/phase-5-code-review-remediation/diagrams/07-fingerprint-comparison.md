# Immutable Financial Request Fingerprint

```mermaid
flowchart TD
    A[Duplicate detected:<br/>existing billing_event found] --> B{Compare eventType}
    B -->|Mismatch| REJECT[409 Conflict:<br/>different parameters]
    B -->|Match| C{Compare amountXlm}
    C -->|Mismatch| REJECT
    C -->|Match| D{eventType == bundle_purchase?}
    D -->|No| ACCEPT[Return duplicate: true]
    D -->|Yes| E{bundlePurchaseId exists?}
    E -->|No| ACCEPT
    E -->|Yes| F[JOIN tenant_bundle_purchases<br/>via bundlePurchaseId FK]
    F --> G{Compare bundleSlugSnapshot}
    G -->|Mismatch| REJECT
    G -->|Match| H{Compare paymentReference}
    H -->|Mismatch| REJECT
    H -->|Match| ACCEPT

    style REJECT fill:#fecaca,stroke:#dc2626
    style ACCEPT fill:#d1fae5,stroke:#059669
    style F fill:#dbeafe
```

## Fingerprint Fields

| Field | Table | Compared For | Null Handling |
|-------|-------|-------------|---------------|
| eventType | billing_events | All types | Never null |
| amountXlm | billing_events | All types | Never null |
| bundleSlugSnapshot | tenant_bundle_purchases | bundle_purchase only | `?? null` coalesce |
| paymentReference | tenant_bundle_purchases | bundle_purchase only | `?? null` coalesce |

**Not compared:** notes, createdBy (mutable metadata safe to vary on retry)
