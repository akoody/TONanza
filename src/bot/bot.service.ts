import { Telegraf, Markup } from "telegraf";
import { env } from "../config/env.js";

export class BotService {
    private bot: Telegraf | null = null;
    private isRunning = false;
    private startInFlight: Promise<void> | null = null;
    private static readonly MINI_APP_LINK = "https://t.me/tonanza_bot/app";
    private static readonly TELEGRAM_SEND_TIMEOUT_MS = 10_000;
    private readonly chatBootstrapCooldownMs = 24 * 60 * 60 * 1000;
    private readonly chatBootstrapSentAt = new Map<string, number>();
    private static readonly NANOTONS_PER_TON = 1_000_000_000n;

    constructor() {
        if (env.TELEGRAM_BOT_TOKEN) {
            this.bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
            this.setupHandlers();
        } else {
            console.warn("[bot] TELEGRAM_BOT_TOKEN not set, bot disabled.");
        }
    }

    private setupHandlers() {
        if (!this.bot) return;

        this.bot.start(async (ctx) => {
            const firstName = this.escapeHtml(ctx.from?.first_name ?? "");
            const userGreeting = firstName ? `, ${firstName}` : "";
            const appUrl = this.resolveFrontendUrl();
            const welcomeText =
                `🎰 <b>TONanza Jackpot</b>\n\n` +
                `Привет${userGreeting}! Добро пожаловать в самую заряженную PvP-рулетку на TON.\n\n` +
                `<b>Что тебя ждет:</b>\n` +
                `• живые раунды с реальными игроками\n` +
                `• честный механизм розыгрыша (Provably Fair)\n` +
                `• быстрые ставки и мгновенный экшен\n\n` +
                `<b>Как начать:</b>\n` +
                `1) Открой игру кнопкой ниже\n` +
                `2) Пополни баланс\n` +
                `3) Поставь ставку и забирай джекпот\n\n` +
                `Удачи в раунде!`;

            if (appUrl) {
                try {
                    await ctx.reply(welcomeText, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.webApp("🎰 Открыть TONanza", appUrl)]
                        ])
                    });
                    return;
                } catch (err) {
                    console.error("[bot] Failed to send /start with web_app button", err);
                    try {
                        await ctx.reply(welcomeText, {
                            parse_mode: "HTML",
                            ...Markup.inlineKeyboard([
                                [Markup.button.url("🎰 Открыть TONanza", BotService.MINI_APP_LINK)]
                            ])
                        });
                        return;
                    } catch (fallbackErr) {
                        console.error("[bot] Failed to send /start with URL button fallback", fallbackErr);
                    }
                }
            }

            const fallbackText = appUrl
                ? welcomeText
                : `${welcomeText}\n\n⚠️ Кнопка запуска сейчас не настроена (FRONTEND_URL).`;

            await ctx.reply(fallbackText, { parse_mode: "HTML" });
        });

        this.bot.command("help", async (ctx) => {
            const appUrl = this.resolveFrontendUrl();
            const helpText =
                `📌 <b>TONanza — быстрый старт</b>\n\n` +
                `• /start — открыть приветствие и кнопку игры\n` +
                `• Минимум ставки: <b>0.1 TON</b>\n` +
                `• Баланс и вывод — в интерфейсе мини-аппа\n\n` +
                `Если что-то не работает, просто напиши /start еще раз.`;

            if (appUrl) {
                try {
                    await ctx.reply(helpText, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.webApp("🎰 Играть", appUrl)]
                        ])
                    });
                    return;
                } catch (err) {
                    console.error("[bot] Failed to send /help with web_app button", err);
                    await ctx.reply(helpText, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("🎰 Играть", BotService.MINI_APP_LINK)]
                        ])
                    });
                    return;
                }
            }

            await ctx.reply(`${helpText}\n\n⚠️ FRONTEND_URL не задан.`, { parse_mode: "HTML" });
        });

        this.bot.catch((err, ctx) => {
            console.error(`[bot] Error for ${ctx.updateType}`, err);
        });
    }

    private resolveFrontendUrl(): string | null {
        const raw = env.FRONTEND_URL?.trim();
        if (!raw || raw === "*") return null;

        try {
            const url = new URL(raw);
            if (url.protocol !== "https:" && url.protocol !== "http:") {
                return null;
            }
            return url.toString();
        } catch {
            return null;
        }
    }

    private escapeHtml(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    }

    private async configureMenuButton() {
        if (!this.bot) return;
        const appUrl = this.resolveFrontendUrl();
        if (!appUrl) return;

        try {
            await this.bot.telegram.callApi("setChatMenuButton", {
                menu_button: {
                    type: "web_app",
                    text: "PLAY",
                    web_app: { url: appUrl }
                }
            });
        } catch (e) {
            console.warn("[bot] Failed to configure chat menu button", e);
        }
    }

    private resolveTelegramChatId(telegramId: bigint): number | string {
        const chatId = telegramId.toString();
        return Number.isSafeInteger(Number(chatId)) && Number(chatId) > 0
            ? Number(chatId)
            : chatId;
    }

    private formatTonAmount(nanotons: bigint): string {
        const sign = nanotons < 0n ? "-" : "";
        const absolute = nanotons < 0n ? -nanotons : nanotons;
        const whole = absolute / BotService.NANOTONS_PER_TON;
        const fraction = ((absolute % BotService.NANOTONS_PER_TON) * 100n) / BotService.NANOTONS_PER_TON;
        return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
    }

    private getTelegramErrorDescription(error: unknown): string {
        if (
            typeof error === "object" &&
            error !== null &&
            "response" in error &&
            typeof (error as { response?: { description?: unknown } }).response?.description === "string"
        ) {
            return (error as { response: { description: string } }).response.description;
        }

        if (error instanceof Error) {
            return error.message;
        }

        return "";
    }

    private resolveSendFailureReason(error: unknown): string {
        const description = this.getTelegramErrorDescription(error).toLowerCase();
        if (description.includes("bot was blocked by the user")) {
            return "BOT_BLOCKED";
        }
        if (description.includes("chat not found") || description.includes("user not found")) {
            return "CHAT_NOT_INITIATED";
        }
        if (description.includes("user is deactivated")) {
            return "USER_DEACTIVATED";
        }
        return "SEND_FAILED";
    }

    private async withTelegramTimeout<T>(operation: Promise<T>): Promise<T> {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error("Telegram send timeout"));
                }, BotService.TELEGRAM_SEND_TIMEOUT_MS);
            })
        ]);
    }

    private async sendNotificationMessage(telegramId: bigint, message: string) {
        if (!this.bot) {
            return { sent: false, reason: "BOT_UNAVAILABLE" };
        }

        if (!this.isRunning) {
            void this.start();
        }

        const appUrl = this.resolveFrontendUrl();
        const chatId = this.resolveTelegramChatId(telegramId);

        try {
            if (appUrl) {
                try {
                    await this.withTelegramTimeout(this.bot.telegram.sendMessage(chatId, message, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.webApp("🎰 Открыть TONanza", appUrl)]
                        ])
                    }));
                    return { sent: true };
                } catch (webAppError) {
                    console.warn("[bot] Failed to send notification with web_app button, retrying with URL button", webAppError);
                    try {
                        await this.withTelegramTimeout(this.bot.telegram.sendMessage(chatId, message, {
                            parse_mode: "HTML",
                            ...Markup.inlineKeyboard([
                                [Markup.button.url("🎰 Открыть TONanza", BotService.MINI_APP_LINK)]
                            ])
                        }));
                        return { sent: true };
                    } catch (urlButtonError) {
                        console.warn("[bot] Failed to send notification with URL button, retrying without buttons", urlButtonError);
                    }
                }
            } else {
                message = `${message}\n\n${BotService.MINI_APP_LINK}`;
            }

            await this.withTelegramTimeout(this.bot.telegram.sendMessage(chatId, message, {
                parse_mode: "HTML"
            }));
            return { sent: true };
        } catch (e) {
            const reason = this.resolveSendFailureReason(e);
            console.warn("[bot] Failed to send notification message", {
                reason,
                description: this.getTelegramErrorDescription(e)
            });
            return { sent: false, reason };
        }
    }

    async start() {
        if (!this.bot || this.isRunning) return;
        if (this.startInFlight) {
            await this.startInFlight;
            return;
        }

        this.startInFlight = (async () => {
            try {
                // Ensure long-polling works even if webhook was set earlier.
                await this.bot?.telegram.deleteWebhook();
                await this.bot?.launch();
                await this.configureMenuButton();
                this.isRunning = true;
                console.log("[bot] Telegram bot started successfully");
            } catch (e) {
                console.error("[bot] Failed to launch bot", e);
            } finally {
                this.startInFlight = null;
            }
        })();

        await this.startInFlight;
    }

    stop() {
        if (this.bot && this.isRunning) {
            this.bot.stop("SIGINT");
            this.isRunning = false;
            console.log("[bot] Telegram bot stopped");
        }
    }

    private cleanupChatBootstrapCache(now: number) {
        for (const [chatId, sentAt] of this.chatBootstrapSentAt.entries()) {
            if (now - sentAt >= this.chatBootstrapCooldownMs) {
                this.chatBootstrapSentAt.delete(chatId);
            }
        }
    }

    private canSendChatBootstrap(chatId: string): boolean {
        const now = Date.now();
        this.cleanupChatBootstrapCache(now);
        const lastSentAt = this.chatBootstrapSentAt.get(chatId);
        if (!lastSentAt) return true;
        return now - lastSentAt >= this.chatBootstrapCooldownMs;
    }

    async sendChatBootstrapMessage(telegramId: bigint): Promise<{ sent: boolean; reason?: string }> {
        if (!this.bot) {
            return { sent: false, reason: "BOT_UNAVAILABLE" };
        }

        if (!this.isRunning) {
            void this.start();
        }

        const chatId = telegramId.toString();
        if (!this.canSendChatBootstrap(chatId)) {
            return { sent: false, reason: "ALREADY_SENT_RECENTLY" };
        }

        const appUrl = this.resolveFrontendUrl();
        const message =
            `✅ Чат активирован\n\n` +
            `Теперь бот может писать вам важные уведомления о TONanza.\n` +
            `Если нужно, откройте приложение кнопкой ниже.`;

        try {
            const resolvedChatId =
                Number.isSafeInteger(Number(chatId)) && Number(chatId) > 0
                    ? Number(chatId)
                    : chatId;

            if (appUrl) {
                try {
                    await this.withTelegramTimeout(this.bot.telegram.sendMessage(resolvedChatId, message, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.webApp("🎰 Открыть TONanza", appUrl)]
                        ])
                    }));
                } catch (webAppError) {
                    console.warn("[bot] Failed to send chat bootstrap with web_app button, retrying with URL button", webAppError);
                    await this.withTelegramTimeout(this.bot.telegram.sendMessage(resolvedChatId, message, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("🎰 Открыть TONanza", BotService.MINI_APP_LINK)]
                        ])
                    }));
                }
            } else {
                await this.withTelegramTimeout(this.bot.telegram.sendMessage(
                    resolvedChatId,
                    `${message}\n\n${BotService.MINI_APP_LINK}`,
                    {
                        parse_mode: "HTML"
                    }
                ));
            }

            this.chatBootstrapSentAt.set(chatId, Date.now());
            return { sent: true };
        } catch (e) {
            const reason = this.resolveSendFailureReason(e);
            console.warn("[bot] Failed to send chat bootstrap message", {
                reason,
                description: this.getTelegramErrorDescription(e)
            });
            return { sent: false, reason };
        }
    }

    async sendDepositCreditedMessage(telegramId: bigint, amountNanotons: bigint) {
        return this.sendNotificationMessage(
            telegramId,
            `💸 Пополнение: <b>${this.formatTonAmount(amountNanotons)} TON</b> успешно зачислено`
        );
    }

    async sendWithdrawalCompletedMessage(telegramId: bigint, amountNanotons: bigint) {
        return this.sendNotificationMessage(
            telegramId,
            `💳 Вывод: <b>${this.formatTonAmount(amountNanotons)} TON</b> успешно выполнен`
        );
    }

    async sendGameWonMessage(telegramId: bigint, gameId: bigint) {
        return this.sendNotificationMessage(
            telegramId,
            `🏆 Вы выиграли в игре <b>#${gameId.toString()}</b>`
        );
    }
}
