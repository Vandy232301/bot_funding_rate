import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, GatewayIntentBits, EmbedBuilder, TextChannel } from 'discord.js';
import axios from 'axios';
import { Signal } from '../common/interfaces/signal.interface';
import { SignalType, SignalBias } from '../database/entities/signal.entity';

/**
 * DiscordAlertService - Sends professional Discord embed alerts
 * Supports both Webhook (preferred) and Bot Token methods
 * Formats signals according to DYNASTY specifications
 */
@Injectable()
export class DiscordAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordAlertService.name);
  private client: Client | null = null;
  private readonly webhookUrl: string;
  private readonly botToken: string;
  private readonly alertChannelId: string;
  private readonly reversalChannelId: string;
  private readonly trendChannelId: string;
  private readonly divergenceChannelId: string;
  private isReady = false;
  private useWebhook = false;

  constructor(private configService: ConfigService) {
    // Webhook URL (preferred method)
    // Default webhook pentru DYNASTY
    this.webhookUrl = this.configService.get<string>(
      'DISCORD_WEBHOOK_URL',
      'https://discord.com/api/webhooks/1467838117645127837/PFHUHID5NspB5soxlqBgSTeRgq5ZD1KN5XGdZNtbPXJYk3bELCQ5erbiTRMfOuFGZgHB',
    );

    // Bot Token (fallback method)
    this.botToken = this.configService.get<string>('DISCORD_BOT_TOKEN', '');
    this.alertChannelId = this.configService.get<string>(
      'DISCORD_ALERT_CHANNEL_ID',
      '',
    );
    this.reversalChannelId = this.configService.get<string>(
      'DISCORD_REVERSAL_CHANNEL_ID',
      this.alertChannelId,
    );
    this.trendChannelId = this.configService.get<string>(
      'DISCORD_TREND_CHANNEL_ID',
      this.alertChannelId,
    );
    this.divergenceChannelId = this.configService.get<string>(
      'DISCORD_DIVERGENCE_CHANNEL_ID',
      this.alertChannelId,
    );

    // Determine which method to use
    if (this.webhookUrl) {
      this.useWebhook = true;
      this.logger.log('Using Discord Webhook for alerts');
    } else if (this.botToken) {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
        ],
      });
      this.logger.log('Using Discord Bot Token for alerts');
    }
  }

  async onModuleInit() {
    // If using webhook, no initialization needed
    if (this.useWebhook) {
      this.isReady = true;
      this.logger.log('Discord webhook ready');
      return;
    }

    // If using bot token, initialize client
    if (this.botToken && this.client) {
      try {
        await this.client.login(this.botToken);
        this.logger.log('Discord bot connected');
        this.isReady = true;
      } catch (error) {
        this.logger.error('Failed to connect Discord bot', error);
      }
    } else {
      this.logger.warn(
        'No Discord webhook URL or bot token configured, alerts will be disabled',
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.destroy();
    }
  }

  /**
   * Send alert to Discord
   * Uses webhook if configured, otherwise falls back to bot
   */
  async sendAlert(signal: Signal): Promise<void> {
    if (!this.isReady) {
      this.logger.warn('Discord not ready, skipping alert');
      return;
    }

    try {
      const embed = this.createEmbed(signal);

      if (this.useWebhook) {
        // Send via webhook (preferred method)
        await this.sendViaWebhook(embed);
      } else if (this.client) {
        // Send via bot (fallback method)
        await this.sendViaBot(embed, signal.signalType);
      }

      this.logger.log(`Alert sent to Discord: ${signal.symbol} ${signal.bias}`);
    } catch (error) {
      this.logger.error('Failed to send Discord alert', error);
    }
  }

  /**
   * Send alert via Discord Webhook
   */
  private async sendViaWebhook(embed: EmbedBuilder): Promise<void> {
    try {
      const payload = {
        embeds: [embed.toJSON()],
      };

      await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logger.error('Failed to send webhook', error);
      throw error;
    }
  }

  /**
   * Send alert via Discord Bot
   */
  private async sendViaBot(
    embed: EmbedBuilder,
    signalType: SignalType,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const channelId = this.getChannelIdForSignalType(signalType);
    const channel = (await this.client.channels.fetch(
      channelId,
    )) as TextChannel;

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    await channel.send({ embeds: [embed] });
  }

  /**
   * Create Discord embed according to DYNASTY format (matching the design)
   */
  private createEmbed(signal: Signal): EmbedBuilder {
    const color = signal.bias === SignalBias.LONG ? 0x00ff00 : 0xff0000; // Green for LONG, Red for SHORT
    const biasEmoji = signal.bias === SignalBias.LONG ? '🟢' : '🔴';

    // Calculate movement if not provided (from momentum)
    const movement = signal.movement || {
      up: Math.abs(signal.momentum === 'Expansion' ? 5.0 : 2.0),
      down: Math.abs(signal.momentum === 'Expansion' ? 5.0 : 2.0),
    };

    // Get RSI values (use provided or fallback to main RSI)
    const rsi15m = signal.rsi15m || signal.rsi;
    const rsi5m = signal.rsi5m || signal.rsi;
    const rsi1m = signal.rsi1m || signal.rsi;

    // Build movement string
    const movementString = `+${movement.up.toFixed(2)}% / -${movement.down.toFixed(2)}%`;

    // Build trade links
    const symbolUpper = signal.symbol.toUpperCase();
    // TradingView format: Try BYBIT first, fallback to BINANCE if symbol not available on BYBIT
    // Some Bybit symbols might not be on TradingView, so we use BINANCE as fallback
    // Format: https://www.tradingview.com/chart/?symbol=EXCHANGE:SYMBOL
    const tradingViewLink = `[TradingView](https://www.tradingview.com/chart/?symbol=BINANCE:${symbolUpper})`;
    const bybitLink = `[Bybit](https://www.bybit.com/trade/usdt/${symbolUpper})`;
    const bybitSymbolLink = `[${signal.symbol}](https://www.bybit.com/trade/usdt/${symbolUpper})`;
    const binanceLink = `[Binance](https://www.binance.com/en/trade/${symbolUpper})`;
    const mexcLink = `[MEXC](https://www.mexc.com/exchange/${symbolUpper})`;
    const tradeOnLinks = `${tradingViewLink} • ${bybitLink} • ${binanceLink} • ${mexcLink}`;

    // Build main info block - each category on one horizontal line with bold important text
    const mainInfo = `🏛️ Symbol **${bybitSymbolLink}**
⏱️ Timeframe **${signal.timeframe}**
📊 Movement **${movementString}**
📈 RSI **15m = ${rsi15m.toFixed(1)} | 5m = ${rsi5m.toFixed(1)} | 1m = ${rsi1m.toFixed(1)}**
💰 Funding Rate **${signal.fundingRate.toFixed(4)}%**
🎯 Bias ${biasEmoji} **${signal.bias}**

Trade on: ${tradeOnLinks}

⚠️ These alerts are informational only and not profit guarantees or financial advice. Always DYOR before entering any trade!`;

    const embed = new EmbedBuilder()
      .setTitle(`🎯 DYNASTY FUNDING RATE ALERTS`)
      .setDescription(mainInfo)
      .setColor(color)
      .setFooter({ text: '⚡ Powered by DYNASTY' })
      .setTimestamp();

    return embed;
  }

  /**
   * Get channel ID based on signal type
   */
  private getChannelIdForSignalType(signalType: SignalType): string {
    // All signals are now REVERSAL type (RSI Confluence)
    // Use reversal channel for all signals
    return this.reversalChannelId || this.alertChannelId;
  }

  /**
   * Check if Discord bot is ready
   */
  isDiscordReady(): boolean {
    return this.isReady;
  }
}