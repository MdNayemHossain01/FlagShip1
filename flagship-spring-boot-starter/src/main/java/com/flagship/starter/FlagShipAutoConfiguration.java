package com.flagship.starter;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.boot.actuate.endpoint.annotation.Endpoint;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

@AutoConfiguration
@EnableConfigurationProperties(FlagShipProperties.class)
@ConditionalOnProperty(prefix = "flagship", name = "enabled", havingValue = "true", matchIfMissing = true)
public class FlagShipAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public FlagShipClient flagShipClient(
            FlagShipProperties properties,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry
    ) {
        return new FlagShipClient(properties, objectMapper, meterRegistry);
    }

    @Bean
    @ConditionalOnMissingBean
    public MeterRegistry fallbackMeterRegistry() {
        return new SimpleMeterRegistry();
    }

    @Bean
    @ConditionalOnMissingBean
    public FeatureEnabledAspect featureEnabledAspect(FlagShipClient client) {
        return new FeatureEnabledAspect(client);
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(Endpoint.class)
    static class FlagShipActuatorConfiguration {

        @Bean
        @ConditionalOnMissingBean
        public FlagShipActuatorEndpoint flagShipActuatorEndpoint(FlagShipClient client) {
            return new FlagShipActuatorEndpoint(client);
        }
    }

    @Endpoint(id = "flagship")
    public static class FlagShipActuatorEndpoint {
        private final FlagShipClient client;

        public FlagShipActuatorEndpoint(FlagShipClient client) {
            this.client = client;
        }

        @ReadOperation
        public Map<String, Object> status() {
            return Map.of(
                    "connectionMode", client.getConnectionMode(),
                    "cachedFlags", client.getCachedFlagCount()
            );
        }
    }
}
