package com.flagship.starter;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "flagship")
public class FlagShipProperties {

    private boolean enabled = true;

    @NotBlank(message = "flagship.server-url must be configured")
    private String serverUrl = "http://localhost:3000";

    @NotBlank(message = "flagship.sdk-key must be configured")
    private String sdkKey;

    private String snapshotFile = "./flagship-offline-snapshot.json";

    @Min(200)
    @Max(2000)
    private long startupTimeoutMs = 1500;

    @Min(3000)
    private long pollIntervalMs = 15000;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getServerUrl() { return serverUrl; }
    public void setServerUrl(String serverUrl) { this.serverUrl = serverUrl; }
    public String getSdkKey() { return sdkKey; }
    public void setSdkKey(String sdkKey) { this.sdkKey = sdkKey; }
    public String getSnapshotFile() { return snapshotFile; }
    public void setSnapshotFile(String snapshotFile) { this.snapshotFile = snapshotFile; }
    public long getStartupTimeoutMs() { return startupTimeoutMs; }
    public void setStartupTimeoutMs(long startupTimeoutMs) { this.startupTimeoutMs = startupTimeoutMs; }
    public long getPollIntervalMs() { return pollIntervalMs; }
    public void setPollIntervalMs(long pollIntervalMs) { this.pollIntervalMs = pollIntervalMs; }
}
