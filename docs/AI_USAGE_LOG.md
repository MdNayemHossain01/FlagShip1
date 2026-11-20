# FlagShip — AI Usage Log & Engineering Verification

This log documents how AI assistance was used during FlagShip development and records three concrete instances where AI-generated code or assumptions had defects that were identified via static checks, unit testing, or design audits and corrected.

## Documented AI Mistakes / Incomplete Outputs & Corrections

### Example 1: Tailwind CSS v4 Dark Mode Split-Brain Bug
- **Defect**: Initial dark-mode styling relied on `dark:*` utility classes with `<html class="dark">` toggling, which in Tailwind CSS v4 defaults to `@media (prefers-color-scheme: dark)` rather than class-based toggling—causing manual Day/Night toggle clicks to leave components stuck in the OS theme.
- **How Identified**: Audited Tailwind v4 dark-mode mechanics before finalizing `src/index.css` and verified class toggling in headless Chromium.
- **Correction**: Added `@custom-variant dark (&:where(.dark, .dark *));` directly beneath `@import "tailwindcss";` in `src/index.css` plus an anti-flash inline bootstrap script in `index.html`.

### Example 2: Production Kill Switch Blocked by Two-Person Approval Gate
- **Defect**: An early draft of the `/flags/:flagId/environments/:envId/config` handler routed *every* Production configuration change into the `approvals` table when `env.requiresApproval === true`. That inadvertently prevented an on-call admin from immediately activating an Emergency Kill Switch during an outage.
- **How Identified**: Reviewed Module 5 (Kill Switch) alongside Module 10 (Production Approval Workflow) and QA3 (Kill-Switch propagation within 5s).
- **Correction**: Added explicit separation: `const isEmergencyKillSwitch = body.killSwitch === true && !current.killSwitch;`. Activating a kill switch executes immediately, logs `KILL_SWITCH_ACTIVATED` with a trace ID, and broadcasts `flag:killswitch` via SSE within milliseconds, whereas clearing the kill switch or expanding rollouts still requires two-person approval.

### Example 3: Signed vs. Unsigned 32-bit Modulo Parity in Java vs. TypeScript MurmurHash3
- **Defect**: A naive Java `MurmurHash3.hash32(...) % 100_000` returns negative bucket indices for ~50% of inputs because Java `int` is signed 32-bit, whereas JavaScript `>>> 0` produces an unsigned 32-bit integer—breaking QA4 cross-language parity between server preview and the Spring Boot Starter.
- **How Identified**: Cross-checked bitwise arithmetic in `src/core/evaluator.ts` against `MurmurHash3.java` while preparing QA4 verification.
- **Correction**: Converted the Java hash output with `Integer.toUnsignedLong(hash32(...)) % 100_000L` so both TypeScript and Java map every UTF-8 `${flagKey}:${userKey}` input to the exact same `[0, 99999]` bucket.
