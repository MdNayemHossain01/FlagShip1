package com.example.shop;

import com.flagship.starter.FeatureEnabled;
import com.flagship.starter.FlagShipClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class CheckoutService {

    private final FlagShipClient flagShip;

    public CheckoutService(FlagShipClient flagShip) {
        this.flagShip = flagShip;
    }

    @GetMapping("/checkout")
    @FeatureEnabled(value = "new-checkout", fallbackMethod = "legacyCheckout")
    public Map<String, Object> newCheckout(@RequestParam String userKey) {
        String cta = flagShip.getString("checkout-cta-copy", userKey, Map.of(), "Place Order");
        double maxItems = flagShip.getNumber("max-cart-items", userKey, Map.of(), 25);
        return Map.of(
                "flow", "EXPRESS_ONE_CLICK",
                "ctaLabel", cta,
                "maxCartItems", (int) maxItems,
                "sdkMode", flagShip.getConnectionMode()
        );
    }

    public Map<String, Object> legacyCheckout(String userKey) {
        return Map.of(
                "flow", "LEGACY_THREE_STEP",
                "userKey", userKey,
                "sdkMode", flagShip.getConnectionMode()
        );
    }
}
