# FlagShip — Architecture Decision Records (ADRs)

## ADR-001: Deterministic MurmurHash3_32 Bucketing for Gradual Rollouts
- **Status**: Accepted
- **Context**: FlagShip must guarantee identical rollout assignments across the control plane previewer, TypeScript SDK, and Java Spring Boot Starter across 1,000,000+ user keys, and expanding a rollout from 10% to 20% must never evict users who were already in the 10% cohort.
- **Decision**: Compute `unsigned(murmurHash3_32(flagKey + ":" + userKey, seed = 0)) % 100_000` and compare `bucket < percentage * 1000`.
- **Consequences**:
  - Zero cross-language drift between Java (`Integer.toUnsignedLong`) and TypeScript (`>>> 0`).
  - Mathematically guaranteed monotonicity (`[0, 10000) ⊂ [0, 20000)`).
  - Measured 1,000,000-user hash throughput in 1.45 seconds with 100.0000% cohort retention.

## ADR-002: Server-Sent Events (SSE) with Automatic Polling Fallback
- **Status**: Accepted
- **Context**: Applications require near-instant kill-switch propagation (< 5 seconds p95) without complex bidirectional WebSocket infrastructure or sticky load-balancer nightmares.
- **Decision**: Implement unidirectional HTTP/1.1+ Server-Sent Events (`/api/sdk/stream` and `/api/stream`) with 20s heartbeats and automatic client-side fallback to `/api/sdk/snapshot` polling whenever SSE disconnects.
- **Consequences**:
  - Works natively over standard HTTP proxies and Cloud Run without custom upgrade protocols.
  - Simpler reconnect semantics and lower memory footprint per connected instance than full-duplex WebSockets.

## ADR-003: Local In-Memory Cache + Disk/Storage Snapshot for Offline Resilience
- **Status**: Accepted
- **Context**: A feature flag control plane outage must never take down or throw exceptions in customer checkout/banking services, nor block startup for more than 2 seconds.
- **Decision**: Both the Java Starter (`FlagShipClient.java`) and TypeScript SDK (`sdkClient.ts`) evaluate flags strictly from an in-memory snapshot backed by local persistence (JSON file on disk / `localStorage`), cap initial HTTP sync at `<= 2000ms`, and catch all internal faults to return caller-supplied typed fallbacks.
- **Consequences**:
  - Evaluation p99 stays under 30 µs regardless of network health.
  - Services survive arbitrary control-plane outages using last-known values.

## ADR-004: Two-Person Production Approval Gate with Emergency Kill Switch Exception
- **Status**: Accepted
- **Context**: Unreviewed production flag edits are a primary cause of customer-facing incidents, yet during an active outage engineers cannot wait for two approvals to disable a broken feature.
- **Decision**: Production environments enforce `requiresApproval = true` (`requiredApprovers = 2`) and forbid self-approval (`requesterId !== approverId`). Staging/Dev apply immediately. Activating an Emergency Kill Switch in Production executes immediately and broadcasts via SSE, while clearing it or modifying rollouts still routes through the approval queue.
- **Consequences**:
  - Prevents single-engineer misconfiguration in Production while preserving sub-second incident mitigation.
