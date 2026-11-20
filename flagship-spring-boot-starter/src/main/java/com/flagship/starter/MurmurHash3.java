package com.flagship.starter;

import java.nio.charset.StandardCharsets;

/**
 * Deterministic MurmurHash3 x86_32 implementation.
 * Matches TypeScript murmurHash3_32() bit-for-bit across all UTF-8 inputs (QA4).
 */
public final class MurmurHash3 {

    private MurmurHash3() {}

    public static int hash32(String input, int seed) {
        byte[] data = input.getBytes(StandardCharsets.UTF_8);
        int len = data.length;
        int h1 = seed;
        final int c1 = 0xcc9e2d51;
        final int c2 = 0x1b873593;
        int roundedEnd = len & ~3;

        for (int i = 0; i < roundedEnd; i += 4) {
            int k1 = (data[i] & 0xff)
                    | ((data[i + 1] & 0xff) << 8)
                    | ((data[i + 2] & 0xff) << 16)
                    | ((data[i + 3] & 0xff) << 24);
            k1 *= c1;
            k1 = Integer.rotateLeft(k1, 15);
            k1 *= c2;

            h1 ^= k1;
            h1 = Integer.rotateLeft(h1, 13);
            h1 = h1 * 5 + 0xe6546b64;
        }

        int k1 = 0;
        switch (len & 3) {
            case 3:
                k1 ^= (data[roundedEnd + 2] & 0xff) << 16;
            case 2:
                k1 ^= (data[roundedEnd + 1] & 0xff) << 8;
            case 1:
                k1 ^= (data[roundedEnd] & 0xff);
                k1 *= c1;
                k1 = Integer.rotateLeft(k1, 15);
                k1 *= c2;
                h1 ^= k1;
            default:
                break;
        }

        h1 ^= len;
        h1 ^= (h1 >>> 16);
        h1 *= 0x85ebca6b;
        h1 ^= (h1 >>> 13);
        h1 *= 0xc2b2ae35;
        h1 ^= (h1 >>> 16);
        return h1;
    }

    public static int computeRolloutBucket(String flagKey, String userKey) {
        long unsigned = Integer.toUnsignedLong(hash32(flagKey + ":" + userKey, 0));
        return (int) (unsigned % 100_000L);
    }
}
