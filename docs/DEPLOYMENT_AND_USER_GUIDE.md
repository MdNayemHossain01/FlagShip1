# FlagShip — Deployment, Starter Quick Start & User Guide

## 1. Local Deployment via Docker Compose (8 GB RAM Budget)

FlagShip's `docker-compose.yml` constrains PostgreSQL (`512 MB`) and the FlagShip server (`512 MB`) to run smoothly on an 8 GB RAM laptop:

```bash
cp .env.example .env
docker compose up --build
```

Verify health endpoints once running:
- Health: `GET http://localhost:3000/api/actuator/health`
- Readiness: `GET http://localhost:3000/api/actuator/health/readiness`
- Metrics: `GET http://localhost:3000/api/actuator/metrics`
- OpenAPI 3.1 Spec: `GET http://localhost:3000/api/openapi.json`

## 2. Free-Tier Cloud Deployment & Platform Limitations

FlagShip can be deployed on free/developer tiers (Google Cloud Run + Cloud SQL Developer Edition, Render Free Web Service + Neon Free PostgreSQL):
- **Cold Starts / Scale-to-Zero**: Free container tiers sleep after 15 minutes of inactivity; initial request takes 3–8 seconds. SDK clients handle this transparently via offline snapshot fallback.
- **Long-Lived SSE Timeouts**: Serverless proxies (e.g., Cloud Run default 5m–60m request timeout) periodically close idle SSE streams. FlagShip SDKs automatically reconnect and fall back to polling during handovers.
- **Connection Limits**: Free PostgreSQL tiers limit concurrent connections (typically 20–50); FlagShip caps its `pg.Pool` at `max: 10`.

## 3. Java Spring Boot Starter — 15-Minute Quick Start (QA5)

1. Install the starter locally:
   ```bash
   cd flagship-spring-boot-starter && mvn clean install
   ```
2. Add the Maven dependency to your Spring Boot 4 application (`pom.xml`):
   ```xml
   <dependency>
       <groupId>com.flagship</groupId>
       <artifactId>flagship-spring-boot-starter</artifactId>
       <version>1.0.0</version>
   </dependency>
   ```
3. Configure `application.yml` with an Environment SDK Key copied from FlagShip -> Environments:
   ```yaml
   flagship:
     server-url: http://localhost:3000
     sdk-key: fs_prod_your_key_here
     snapshot-file: ./data/flagship-snapshot.json
     startup-timeout-ms: 1500
   ```
4. Guard any Spring Bean method with `@FeatureEnabled` or inject `FlagShipClient`:
   ```java
   @FeatureEnabled(value = "new-checkout", fallbackMethod = "legacyCheckout")
   public Receipt checkout(String userKey) { ... }
   ```
5. Inspect `/actuator/flagship` to verify `connectionMode: SSE_CONNECTED` and `cachedFlags`.

## 4. 15-Minute Live Technical Defence Script

1. **Min 0–2 (Auth, RBAC & Day/Night Mode)**: Sign in as `admin@flagship.dev`, demonstrate instant Night/Day theme switching and reload persistence.
2. **Min 2–4 (Dashboard & Real SQL Telemetry)**: Walk through the 8 PostgreSQL KPIs, Flag Activity & Rollout Distribution charts, and Environment Summary.
3. **Min 4–6 (Feature Flags & Targeting Builder)**: Create a flag, inspect Flag Details Live Evaluator, build an AND/OR rule using `SEMVER_GT` and reusable Segments.
4. **Min 6–8 (Deterministic Gradual Rollout)**: Open Rollout Manager, show the 100-user MurmurHash3 cohort matrix proving 10% -> 20% retains 100% of original users.
5. **Min 8–10 (Two-Person Production Approval & Emergency Kill Switch)**: Queue a Production rollout change -> show it stays staged in Approvals with before/after diff -> switch role or approve -> trigger Emergency Kill Switch and observe immediate SSE notification.
6. **Min 10–12 (Offline Resilience Simulator)**: Open Settings & SDK -> click "Simulate Server Outage" -> evaluate flags locally in microseconds with zero exceptions.
7. **Min 12–14 (Experiments, SRM Analytics & Flag Hygiene)**: Record live conversion events, inspect Z-test p-value & Chi-Square SRM health, and archive a stale flag in Flag Hygiene.
8. **Min 14–15 (QA Benchmarks & Architecture)**: Show real measured `scripts/qa-benchmarks.ts` output (27.4 µs p99, 1.16 MB heap, 1M user monotonicity).
