package com.flagship.starter;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;

import java.lang.reflect.Method;
import java.util.Collections;

@Aspect
public class FeatureEnabledAspect {

    private final FlagShipClient client;

    public FeatureEnabledAspect(FlagShipClient client) {
        this.client = client;
    }

    @Around("@annotation(featureEnabled)")
    public Object guardFeature(ProceedingJoinPoint pjp, FeatureEnabled featureEnabled) throws Throwable {
        Object[] args = pjp.getArgs();
        String userKey = (args.length > 0 && args[0] != null) ? String.valueOf(args[0]) : "anonymous";
        boolean enabled = client.getBoolean(
                featureEnabled.value(),
                userKey,
                Collections.emptyMap(),
                featureEnabled.defaultValue()
        );
        if (enabled) {
            return pjp.proceed();
        }
        if (!featureEnabled.fallbackMethod().isBlank()) {
            MethodSignature sig = (MethodSignature) pjp.getSignature();
            Method fallback = pjp.getTarget().getClass().getMethod(
                    featureEnabled.fallbackMethod(), sig.getParameterTypes());
            return fallback.invoke(pjp.getTarget(), args);
        }
        return null;
    }
}
