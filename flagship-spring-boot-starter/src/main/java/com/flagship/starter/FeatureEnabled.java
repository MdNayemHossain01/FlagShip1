package com.flagship.starter;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Guards a Spring Bean method behind a FlagShip feature flag using Spring AOP.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface FeatureEnabled {
    String value();
    String fallbackMethod() default "";
    boolean defaultValue() default false;
}
