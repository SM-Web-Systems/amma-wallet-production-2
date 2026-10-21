# 01-ARCHITECTURE: System Architecture Overview

**Date:** 2026-10-20
**Commit:** `a65e19c`

---

## 1. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| HTTP framework | Fastify | 5.2.x |
| Language | TypeScript | 5.7.x |
| Runtime | tsx (no compile step) | 4.22.x |
| ORM | Drizzle ORM | 0.45.x |
| Database | PostgreSQL via Neon serverless | postgres 3.4.x |
| Blockchain | Stellar SDK + Wallet SDK | 12.x / 1.7.x |
| Process manager | PM2 (`amma-backend`) | Production only |
| Test framework | vitest | 2.1.x |
| Schema tooling | drizzle-kit (`db:push`, no migrations) | 0.31.x |

Notable dependencies: `bcryptjs` (password hashing), `jsonwebtoken` (JWT), `speakeasy` (TOTP 2FA), `nodemailer` (SMTP), `web-push` (push notifications), `twilio` (SMS), `qrcode` (2FA QR).

## 2. Directory Structure

```
packages/backend/src/
  server.ts              Entry point: bootstrap, middleware, route registration, cron jobs
  config/index.ts        Environment variable resolution and startup validation
  db/
    index.ts             Drizzle ORM + postgres.js connection (max 10, idle 20s)
    schema/index.ts      37 tables in one file (1,181 lines)
    seed/                Known-tokens seed data
  routes/                Route modules (auth, admin, tenant, sso, oauth, wallets, etc.)
  middleware/
    auth.ts              User JWT middleware (Bearer token)
    admin-auth.ts        Internal admin JWT middleware (separate secret)
    tenant-api-key.ts    Tenant API key middleware (x-api-key header, SHA-256 hashed)
    turnstile.ts         Cloudflare Turnstile CAPTCHA verification
  services/
    billing.service.ts   Core billing logic (BigInt stroops arithmetic, TOCTOU guards)
    consent.service.ts   OAuth consent management
    oauth-client.service.ts  OAuth client registry
    token-registry.service.ts  JTI tracking and cleanup
  jobs/
    auto-suspension.ts   Hourly: suspend/unsuspend tenants based on balance
    monthly-maintenance.ts  Hourly check: monthly per-active-user billing
    token-indexer.ts     Every 15 min: sync token metadata from StellarExpert
  lib/
    audit.ts             Audit log writer
    stellar-client.ts    Horizon/Soroban client singleton
    liquifier.ts         Convert non-XLM platform fees to XLM via DEX
    email.ts / mailer.ts SMTP email sending
    decrypt-secret.ts    AES-GCM wallet secret decryption (delegated signing)
    totp-crypto.ts       TOTP secret encryption (AES-256-GCM)
    docker-secrets.ts    DATABASE_URL resolution (Docker secrets or env)
    oauth-signing.ts     ES256 JWT signing for OAuth 2.1
  modules/
    tokens/              TokenService (search, featured, user balances)
    swap/                SwapService (DEX quotes, path payment building)
    nft/                 NFT collection and token management
```

## 3. Runtime Architecture

- **No Docker for the backend process.** PM2 runs `tsx src/server.ts` directly on the host. Docker secrets are read from the filesystem if present (`docker-secrets.ts`), otherwise env vars are used.
- **No compile step.** `tsx` transpiles TypeScript at runtime; `package.json` build script is `echo 'using tsx runtime'`.
- **Fastify instance** created with 1 MB body limit and built-in logger. Listens on `0.0.0.0:3001`.
- **Cron jobs are `setInterval` calls** inside `bootstrap()`, not external schedulers:

| Job | Interval | Purpose |
|-----|----------|---------|
| Token indexer | 15 min | Sync from StellarExpert |
| Monthly maintenance billing | 1 hr | Charge per-active-user fees |
| Auto-suspension check | 1 hr | Suspend/unsuspend tenants |
| Refresh token cleanup | 1 hr | Purge expired refresh tokens |
| Password reset cleanup | 6 hr | Purge expired/used reset tokens |
| Audit log cleanup | 24 hr | Delete logs older than 90 days |
| Token registry cleanup | 24 hr | Purge expired OAuth JTI entries |
| Auto-liquifier | 6 hr | Convert platform fee tokens to XLM |
| TOML image sync | 6 hr | Refresh token icon URLs |

## 4. Database

- **PostgreSQL** hosted on Neon (serverless). Connected via `postgres` (postgres.js) driver with `max: 10` connections, `idle_timeout: 20`, `connect_timeout: 10`.
- **Drizzle ORM** with all 37 tables defined in a single schema file. Schema changes are applied via `drizzle-kit push` (no migration files).
- **37 tables** in two groups:
  - **15 core tables:** users, user_wallets, refresh_tokens, password_reset_tokens, email_codes, tokens, contract_tokens, user_tokens, tx_history, liquidity_pools, sync_state, address_book, portfolio_snapshots, push_subscriptions, api_keys, audit_logs
  - **22 multi-tenant/billing tables (Phase 0):** tenants, tenant_billing_policy, tenant_api_keys, wallet_roles, funding_events, fee_split_rules, tenant_members, tenant_users, tenant_alert_log, referral_campaigns, referral_codes, tenant_referral_codes, internal_admins, admin_tenant_assignments, bundle_catalog, tenant_bundle_purchases, unallocated_deposits, billing_events, referrals, provisioning_queue, monthly_maintenance_snapshots, system_config
  - **4 OAuth/SSO tables:** oauth_clients, token_registry, consent_records, sso_used_jtis
  - **2 NFT tables:** nft_collections, nft_tokens
- **Manual SQL patches** are required for: DEFERRABLE unique constraints, self-referential FKs, and compound CHECK constraints that Drizzle ORM cannot express.

## 5. Authentication Layers

Three distinct authentication systems operate in parallel. Full details in `02-RBAC-SPEC.md`.

| System | Secret | Middleware | Purpose |
|--------|--------|-----------|---------|
| **User JWT** | `JWT_SECRET` / `JWT_REFRESH_SECRET` | `middleware/auth.ts` | End-user wallet operations |
| **Admin JWT** | `ADMIN_JWT_SECRET` | `middleware/admin-auth.ts` | Internal staff dashboard |
| **Tenant API Key** | SHA-256 hashed in DB | `middleware/tenant-api-key.ts` | External service integration (e.g. LMS) |

Startup validation in `config/index.ts` enforces:
- All five critical secrets present (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, `SSO_SECRET`)
- Minimum 16-character length for JWT/SSO secrets
- Key confusion guards: `ADMIN_JWT_SECRET != JWT_SECRET`, `SSO_SECRET != JWT_SECRET`, `JWT_REFRESH_SECRET != JWT_SECRET`
- Production-only: `PLATFORM_SECRET`, `SIGNING_SECRET_KEY`, `TURNSTILE_SECRET_KEY` required

Additionally, **OAuth 2.1** (ES256 signing) supports multi-RP SSO for relying parties. The signing key is loaded from a Docker secret file or env var (`config/index.ts:110-112`).

## 6. Billing System

Brief overview; full specification in `03-BILLING-SPEC.md`.

- **Prepaid balance model:** Each tenant has `prepaid_xlm_balance` in the `tenants` table. All charges and credits flow through `billing_events` (append-only ledger).
- **9 event types:** bundle_purchase, manual_topup, manual_adjustment, unallocated_deposit_allocated, stellar_tx_refund (credits); new_wallet_activation, existing_user_onboarding, monthly_maintenance_charge, tenant_referral_reward (debits).
- **BigInt stroops arithmetic:** All monetary math uses BigInt with 10^7 scale factor. No floating-point in financial paths. (`services/billing.service.ts`)
- **TOCTOU protection:** `checkWalletBillingTx` acquires `SELECT ... FOR UPDATE` row lock before balance checks. (`billing.service.ts:322-429`)
- **Auto-suspension:** Hourly job checks balance against `acquisition_debt_limit_xlm` and grace period expiry. Suspended tenants' API keys return 402.
- **Monthly maintenance:** Hourly check bills active users (within activity window). Idempotent via `UNIQUE(tenant_id, billing_period)` on snapshots.

## 7. External Integrations

| Integration | Protocol | Auth Method | File |
|-------------|----------|-------------|------|
| **Stellar Horizon** | HTTPS | Signing keypairs | `lib/stellar-client.ts` |
| **Stellar Soroban RPC** | HTTPS | Signing keypairs | `lib/stellar-client.ts` |
| **StellarExpert** | HTTPS (proxy) | None (public API) | `server.ts` (proxy routes) |
| **Neon PostgreSQL** | TLS/postgres | Connection string | `db/index.ts` |
| **SMTP (Stalwart)** | SMTP/TLS | User/pass | `lib/email.ts`, `lib/mailer.ts` |
| **Cloudflare Turnstile** | HTTPS | Secret key | `middleware/turnstile.ts` |
| **Twilio** | HTTPS | Account SID + auth token | `lib/sms.ts` |
| **MoneyGram (SEP-24)** | HTTPS | SEP-10 auth | `routes/moneygram.ts` |
| **Web Push (VAPID)** | HTTPS | VAPID keypair | `routes/push.ts` |

## 8. Key Architectural Decisions

1. **No Docker for backend.** PM2 manages the Node.js process directly. Docker secrets are still supported for credential injection via filesystem reads (`lib/docker-secrets.ts`).

2. **tsx runtime, no build step.** TypeScript is transpiled on-the-fly. The `build` script is a no-op. This simplifies deployment but means runtime startup includes transpilation overhead.

3. **BigInt stroops for money.** All XLM amounts use `BigInt(amount * 10^7)` internally, matching Stellar's stroop precision. String-based `numeric(18,7)` in PostgreSQL. No floating-point in financial code paths.

4. **Append-only billing ledger.** `billing_events` rows are never updated or deleted. Balance is the running sum. Credits are positive, debits are negative. `CHECK (amount_xlm <> 0)` prevents zero-value entries.

5. **Separate JWT secrets.** Three independent signing secrets prevent token confusion across authentication domains. Startup validation enforces uniqueness.

6. **Single schema file, push-based DDL.** All 37 tables live in `db/schema/index.ts`. Schema changes go through `drizzle-kit push` (diff-and-apply), not versioned migrations. Manual SQL patches handle constraints Drizzle cannot express.

7. **In-process cron via `setInterval`.** No external job scheduler. All recurring tasks run inside the main process. Idempotency is enforced at the database level (unique constraints, boolean guards).

8. **Monorepo with independent packages.** Backend, web app, mobile, and Chrome extension coexist under `packages/`. Only the backend package is relevant to this audit.
