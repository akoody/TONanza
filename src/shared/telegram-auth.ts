import { createHmac, timingSafeEqual } from "node:crypto";

interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    allows_write_to_pm?: boolean;
}

interface ValidatedData {
    user: TelegramUser;
    auth_date: number;
    [key: string]: any;
}

/**
 * Validates the Telegram WebApp initData string.
 *
 * @param initData The raw initData string from WebApp.initData
 * @param botToken The Telegram Bot Token
 * @param maxAgeSeconds Maximum age for auth_date to mitigate replay attacks
 * @returns The parsed data object if valid, or null if invalid
 */
export function validateTelegramWebAppData(
    initData: string,
    botToken: string,
    maxAgeSeconds: number = 24 * 60 * 60
): ValidatedData | null {
    if (!initData || !botToken) return null;

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return null;

    urlParams.delete("hash");

    const dataCheckString = Array.from(urlParams.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
    const receivedHash = Buffer.from(hash, "hex");
    if (receivedHash.length !== calculatedHash.length || !timingSafeEqual(calculatedHash, receivedHash)) {
        return null;
    }

    const userString = urlParams.get("user");
    const authDate = parseInt(urlParams.get("auth_date") || "0", 10);
    if (!Number.isFinite(authDate) || authDate <= 0) return null;
    if (maxAgeSeconds > 0) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (authDate > nowSeconds + 60) return null;
        if (nowSeconds - authDate > maxAgeSeconds) return null;
    }

    if (!userString) return null;

    try {
        const user = JSON.parse(userString) as TelegramUser;
        if (!Number.isInteger(user.id) || user.id <= 0) return null;

        const result: ValidatedData = {
            user,
            auth_date: authDate
        };

        // Add other params
        urlParams.forEach((val, key) => {
            if (key !== "user" && key !== "auth_date") {
                result[key] = val;
            }
        });

        return result;
    } catch {
        return null;
    }
}
