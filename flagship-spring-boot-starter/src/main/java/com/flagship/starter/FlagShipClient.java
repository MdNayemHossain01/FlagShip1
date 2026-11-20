package com.flagship.starter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

/**
 * FlagShip Local Evaluation Client for Spring Boot applications.
 * - Evaluates locally in memory (zero network hops per call)
 * - Enforces exact 5-step evaluation precedence:
 *   1. Kill Switch -> 2. Individual Targets -> 3. Segment & Targeting Rules (AND/OR, 12 operators)
 *   -> 4. MurmurHash3 Sticky Rollout -> 5. Default Variation
 * - Persists snapshot to disk for offline startup & resilience (QA2)
 * - Never blocks startup longer than startupTimeoutMs (<= 2000ms)
 * - Connects to SSE stream with automatic reconnection and polling fallback
 * - Never throws server outages to business logic
 */
public class FlagShipClient {

    private static final Logger log = LoggerFactory.getLogger(FlagShipClient.class);

    private final FlagShipProperties props;
    private final ObjectMapper mapper;
    private final HttpClient httpClient;
    private final AtomicReference<JsonNode> snapshotRef = new AtomicReference<>();
    private final AtomicReference<String> connectionMode = new AtomicReference<>("INITIALIZING");
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
    private final Counter evalCounter;
    private final Counter cacheHitCounter;
    private final Counter cacheMissCounter;
    private final Timer evalTimer;

    private volatile boolean running = true;

    public FlagShipClient(FlagShipProperties props, ObjectMapper mapper, MeterRegistry registry) {
        this.props = props;
        this.mapper = mapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(Math.min(2000, props.getStartupTimeoutMs())))
                .build();
        this.evalCounter = Counter.builder("flagship.evaluations.total").register(registry);
        this.cacheHitCounter = Counter.builder("flagship.cache.hits").register(registry);
        this.cacheMissCounter = Counter.builder("flagship.cache.misses").register(registry);
        this.evalTimer = Timer.builder("flagship.evaluation.duration").register(registry);
    }

    @PostConstruct
    public void initialize() {
        loadSnapshotFromDisk();
        CompletableFuture<Void> initialFetch = CompletableFuture.runAsync(this::fetchSnapshotSafe);
        try {
            initialFetch.get(Math.min(2000, props.getStartupTimeoutMs()), TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            log.warn("FlagShip initial sync exceeded {}ms or server unreachable; continuing with offline snapshot.",
                    props.getStartupTimeoutMs());
            connectionMode.set("OFFLINE_SNAPSHOT");
        }
        scheduler.execute(this::runSseLoop);
        scheduler.scheduleAtFixedRate(this::pollFallbackIfNeeded,
                props.getPollIntervalMs(), props.getPollIntervalMs(), TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    public void shutdown() {
        running = false;
        scheduler.shutdownNow();
    }

    private void loadSnapshotFromDisk() {
        try {
            Path path = Path.of(props.getSnapshotFile());
            if (Files.exists(path)) {
                JsonNode node = mapper.readTree(Files.readString(path, StandardCharsets.UTF_8));
                snapshotRef.set(node);
                log.info("Loaded offline FlagShip snapshot from {}", path);
            }
        } catch (Exception e) {
            log.warn("Could not read offline snapshot file: {}", e.getMessage());
        }
    }

    private void persistSnapshot(String rawJson) {
        try {
            JsonNode parsed = mapper.readTree(rawJson);
            snapshotRef.set(parsed);
            Path path = Path.of(props.getSnapshotFile());
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(path, rawJson, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("Failed to persist FlagShip snapshot: {}", e.getMessage());
        }
    }

    private boolean fetchSnapshotSafe() {
        try {
            String url = props.getServerUrl().replaceAll("/$", "")
                    + "/api/sdk/snapshot?sdkKey=" + URLEncoder.encode(props.getSdkKey(), StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(Math.min(2000, props.getStartupTimeoutMs())))
                    .GET().build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                persistSnapshot(resp.body());
                return true;
            }
        } catch (Exception e) {
            log.debug("FlagShip snapshot fetch failed (offline resilience active): {}", e.getMessage());
        }
        return false;
    }

    private void runSseLoop() {
        while (running) {
            try {
                String url = props.getServerUrl().replaceAll("/$", "")
                        + "/api/sdk/stream?sdkKey=" + URLEncoder.encode(props.getSdkKey(), StandardCharsets.UTF_8);
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                        .header("Accept", "text/event-stream")
                        .GET().build();
                HttpResponse<java.io.InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
                if (resp.statusCode() == 200) {
                    connectionMode.set("SSE_CONNECTED");
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
                        String line;
                        String currentEvent = "message";
                        while (running && (line = reader.readLine()) != null) {
                            if (line.startsWith("event:")) {
                                currentEvent = line.substring(6).trim();
                            } else if (line.startsWith("data:")) {
                                String data = line.substring(5).trim();
                                if ("snapshot".equals(currentEvent)) {
                                    persistSnapshot(data);
                                } else if (currentEvent.startsWith("flag:")) {
                                    fetchSnapshotSafe();
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                connectionMode.set("POLLING_FALLBACK");
            }
            try {
                Thread.sleep(3000);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    private void pollFallbackIfNeeded() {
        if (!"SSE_CONNECTED".equals(connectionMode.get())) {
            boolean ok = fetchSnapshotSafe();
            connectionMode.set(ok ? "POLLING_FALLBACK" : "OFFLINE_SNAPSHOT");
        }
    }

    public boolean getBoolean(String flagKey, String userKey, Map<String, Object> attrs, boolean fallback) {
        JsonNode value = evaluateRaw(flagKey, userKey, attrs);
        return value != null && value.isBoolean() ? value.asBoolean() : fallback;
    }

    public String getString(String flagKey, String userKey, Map<String, Object> attrs, String fallback) {
        JsonNode value = evaluateRaw(flagKey, userKey, attrs);
        return value != null && value.isTextual() ? value.asText() : fallback;
    }

    public double getNumber(String flagKey, String userKey, Map<String, Object> attrs, double fallback) {
        JsonNode value = evaluateRaw(flagKey, userKey, attrs);
        return value != null && value.isNumber() ? value.asDouble() : fallback;
    }

    public JsonNode getJson(String flagKey, String userKey, Map<String, Object> attrs, JsonNode fallback) {
        JsonNode value = evaluateRaw(flagKey, userKey, attrs);
        return value != null && (value.isObject() || value.isArray()) ? value : fallback;
    }

    private JsonNode evaluateRaw(String flagKey, String userKey, Map<String, Object> attrs) {
        return evalTimer.record(() -> {
            evalCounter.increment();
            try {
                JsonNode snapshot = snapshotRef.get();
                if (snapshot == null || !snapshot.has("flags") || !snapshot.get("flags").has(flagKey)) {
                    cacheMissCounter.increment();
                    return null;
                }
                cacheHitCounter.increment();
                JsonNode flag = snapshot.get("flags").get(flagKey);
                JsonNode segmentsNode = snapshot.path("segments");
                Map<String, Object> safeAttrs = attrs != null ? attrs : Map.of();

                // Step 1: Kill Switch & Enabled Gate
                if (flag.path("killSwitch").asBoolean(false) || !flag.path("enabled").asBoolean(false)) {
                    return resolveVariation(flag, flag.path("offVariationKey").asText("off"));
                }

                // Step 2: Individual User Targets
                JsonNode individualTargets = flag.path("individualTargets");
                if (userKey != null && individualTargets.has(userKey)) {
                    return resolveVariation(flag, individualTargets.get(userKey).asText());
                }

                // Step 3: Segment & Targeting Rules (Priority Order, Nested AND/OR, 12 Operators)
                JsonNode rulesNode = flag.path("rules");
                if (rulesNode.isArray() && !rulesNode.isEmpty()) {
                    List<JsonNode> sortedRules = new ArrayList<>();
                    rulesNode.forEach(sortedRules::add);
                    sortedRules.sort(Comparator.comparingInt(r -> r.path("priority").asInt(0)));

                    for (JsonNode rule : sortedRules) {
                        if (!rule.path("enabled").asBoolean(true)) {
                            continue;
                        }
                        boolean matched = false;
                        JsonNode segKeyNode = rule.get("segmentKey");
                        if (segKeyNode != null && !segKeyNode.isNull() && !segKeyNode.asText().isBlank()) {
                            JsonNode segment = segmentsNode.path(segKeyNode.asText());
                            if (!segment.isMissingNode() && matchesSegment(segment, userKey, safeAttrs)) {
                                matched = true;
                            }
                        } else {
                            JsonNode group = rule.path("ruleGroup");
                            if (!group.isMissingNode() && matchesRuleGroup(group, userKey, safeAttrs)) {
                                matched = true;
                            }
                        }

                        if (matched) {
                            return resolveVariation(flag, rule.path("serveVariationKey").asText());
                        }
                    }
                }

                // Step 4: Deterministic Percentage Rollout (MurmurHash3_32)
                int bucket = MurmurHash3.computeRolloutBucket(flagKey, userKey != null ? userKey : "");
                JsonNode weights = flag.path("rolloutWeights");
                if (weights.isArray() && !weights.isEmpty()) {
                    int totalWeight = 0;
                    for (JsonNode w : weights) {
                        totalWeight += Math.max(0, w.path("weight").asInt(0));
                    }
                    if (totalWeight > 0) {
                        int cumulative = 0;
                        for (JsonNode w : weights) {
                            cumulative += Math.max(0, w.path("weight").asInt(0)) * 1000;
                            if (bucket < cumulative) {
                                return resolveVariation(flag, w.path("variationKey").asText());
                            }
                        }
                    }
                } else {
                    int pct = flag.path("rolloutPercentage").asInt(0);
                    if (pct > 0 && bucket < pct * 1000) {
                        return resolveVariation(flag, flag.path("rolloutVariationKey").asText("on"));
                    }
                }

                // Step 5: Environment Default Variation
                return resolveVariation(flag, flag.path("envDefaultVariationKey").asText("off"));
            } catch (Exception e) {
                return null;
            }
        });
    }

    private boolean matchesSegment(JsonNode segment, String userKey, Map<String, Object> attrs) {
        if (userKey != null) {
            for (JsonNode excluded : segment.path("excludedUsers")) {
                if (userKey.equals(excluded.asText())) {
                    return false;
                }
            }
            for (JsonNode included : segment.path("includedUsers")) {
                if (userKey.equals(included.asText())) {
                    return true;
                }
            }
        }
        JsonNode ruleGroup = segment.path("ruleGroup");
        return !ruleGroup.isMissingNode() && matchesRuleGroup(ruleGroup, userKey, attrs);
    }

    private boolean matchesRuleGroup(JsonNode group, String userKey, Map<String, Object> attrs) {
        JsonNode children = group.path("children");
        if (!children.isArray() || children.isEmpty()) {
            return false;
        }
        String combinator = group.path("combinator").asText("AND");
        boolean isOr = "OR".equalsIgnoreCase(combinator);

        for (JsonNode child : children) {
            boolean result;
            if ("group".equals(child.path("type").asText())) {
                result = matchesRuleGroup(child, userKey, attrs);
            } else {
                result = matchesCondition(child, userKey, attrs);
            }
            if (isOr && result) return true;
            if (!isOr && !result) return false;
        }
        return !isOr;
    }

    private boolean matchesCondition(JsonNode cond, String userKey, Map<String, Object> attrs) {
        String attribute = cond.path("attribute").asText("");
        String operator = cond.path("operator").asText("EQUALS");
        JsonNode expected = cond.path("value");

        Object rawActual = "userKey".equals(attribute) ? userKey : attrs.get(attribute);
        if (rawActual == null) {
            return "NOT_EQUALS".equals(operator) || "NOT_IN".equals(operator);
        }
        String actualStr = String.valueOf(rawActual);
        String expectedStr = expected.isTextual() ? expected.asText() : expected.toString();

        return switch (operator) {
            case "EQUALS" -> actualStr.equals(expectedStr);
            case "NOT_EQUALS" -> !actualStr.equals(expectedStr);
            case "IN" -> valueInList(actualStr, expected);
            case "NOT_IN" -> !valueInList(actualStr, expected);
            case "CONTAINS" -> actualStr.toLowerCase().contains(expectedStr.toLowerCase());
            case "STARTS_WITH" -> actualStr.startsWith(expectedStr);
            case "ENDS_WITH" -> actualStr.endsWith(expectedStr);
            case "REGEX" -> matchesRegexSafe(actualStr, expectedStr);
            case "SEMVER_GT" -> compareSemver(actualStr, expectedStr) > 0;
            case "SEMVER_LT" -> compareSemver(actualStr, expectedStr) < 0;
            case "DATE_BEFORE" -> compareDates(actualStr, expectedStr) < 0;
            case "DATE_AFTER" -> compareDates(actualStr, expectedStr) > 0;
            default -> false;
        };
    }

    private boolean valueInList(String actual, JsonNode expected) {
        if (expected.isArray()) {
            for (JsonNode item : expected) {
                if (actual.equals(item.asText())) return true;
            }
            return false;
        }
        for (String token : expected.asText("").split(",")) {
            if (actual.equals(token.trim())) return true;
        }
        return false;
    }

    private boolean matchesRegexSafe(String actual, String pattern) {
        try {
            return Pattern.compile(pattern).matcher(actual).find();
        } catch (Exception e) {
            return false;
        }
    }

    private int compareSemver(String a, String b) {
        int[] pa = parseSemver(a);
        int[] pb = parseSemver(b);
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return Integer.compare(pa[i], pb[i]);
        }
        return 0;
    }

    private int[] parseSemver(String raw) {
        String clean = raw == null ? "" : raw.trim().replaceFirst("^v", "").split("[-+]")[0];
        String[] parts = clean.split("\\.");
        int[] out = new int[]{0, 0, 0};
        for (int i = 0; i < Math.min(3, parts.length); i++) {
            try {
                out[i] = Integer.parseInt(parts[i]);
            } catch (NumberFormatException ignored) {
                out[i] = 0;
            }
        }
        return out;
    }

    private int compareDates(String a, String b) {
        try {
            Instant ia = parseInstant(a);
            Instant ib = parseInstant(b);
            return ia.compareTo(ib);
        } catch (Exception e) {
            return 0;
        }
    }

    private Instant parseInstant(String raw) {
        try {
            return Instant.parse(raw);
        } catch (Exception ignored) {
            return LocalDate.parse(raw).atStartOfDay().toInstant(ZoneOffset.UTC);
        }
    }

    private JsonNode resolveVariation(JsonNode flag, String variationKey) {
        for (JsonNode v : flag.path("variations")) {
            if (variationKey.equals(v.path("variationKey").asText())) {
                return v.get("value");
            }
        }
        return null;
    }

    public String getConnectionMode() {
        return connectionMode.get();
    }

    public int getCachedFlagCount() {
        JsonNode snap = snapshotRef.get();
        return snap != null && snap.has("flags") ? snap.get("flags").size() : 0;
    }
}
