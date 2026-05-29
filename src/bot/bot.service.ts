import { Markup, Telegraf } from "telegraf";
import { env } from "../config/env.js";

export class BotService {
  private bot: Telegraf | null = null;
  private isRunning = false;

  constructor() {
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.warn("[bot] TELEGRAM_BOT_TOKEN is not set, bot disabled.");
      return;
    }

    this.bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
    this.setupHandlers();
  }

  async start() {
    if (!this.bot || this.isRunning) return;
    await this.configureMenuButton();
    await this.bot.launch();
    this.isRunning = true;
    console.info("[bot] started");
  }

  async stop() {
    if (!this.bot || !this.isRunning) return;
    this.bot.stop("shutdown");
    this.isRunning = false;
  }

  async sendDealNotification(telegramId: string, dealCode: string, text: string) {
    if (!this.bot) return { sent: false, reason: "BOT_DISABLED" };
    const appUrl = this.resolveAppUrl(dealCode);
    const chatId = Number.isSafeInteger(Number(telegramId)) ? Number(telegramId) : telegramId;

    try {
      await this.bot.telegram.sendMessage(chatId, this.escapeHtml(text), {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.webApp("Открыть сделку", appUrl)]])
      });
      return { sent: true, reason: null };
    } catch (error) {
      console.warn("[bot] failed to send deal notification", error);
      return { sent: false, reason: "SEND_FAILED" };
    }
  }

  private setupHandlers() {
    if (!this.bot) return;

    this.bot.start(async (ctx) => {
      const firstName = this.escapeHtml(ctx.from?.first_name ?? "");
      const greeting = firstName ? `, ${firstName}` : "";
      const appUrl = this.resolveAppUrl();
      const text =
        `<b>Безопасные сделки</b>\n\n` +
        `Привет${greeting}. Здесь можно создать сделку, найти ее по коду и вести чат с администратором.`;

      await ctx.reply(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.webApp("Открыть приложение", appUrl)]])
      });
    });

    this.bot.catch((error, ctx) => {
      console.error(`[bot] error for ${ctx.updateType}`, error);
    });
  }

  private async configureMenuButton() {
    if (!this.bot) return;
    try {
      await this.bot.telegram.callApi("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "Сделки",
          web_app: { url: this.resolveAppUrl() }
        }
      });
    } catch (error) {
      console.warn("[bot] failed to configure menu button", error);
    }
  }

  private resolveAppUrl(dealCode?: string) {
    const base = env.FRONTEND_URL || "https://example.com";
    const url = new URL(base);
    if (dealCode) url.searchParams.set("deal", dealCode);
    return url.toString();
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }
}
