import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketDataService } from '../market/market-data.service';
import { FundingStreamService } from '../market/funding-stream.service';
import { SignalValidatorService } from './signal-validator.service';
import { ScoringEngineService } from '../scoring/scoring-engine.service';
import { DiscordAlertService } from '../discord/discord-alert.service';
import { IndicatorService } from '../indicators/indicator.service';
import { Signal as SignalEntity } from '../database/entities/signal.entity';
import { FundingSnapshot } from '../database/entities/funding-snapshot.entity';
import { Signal } from '../common/interfaces/signal.interface';
import Redis from 'ioredis';

/**
 * SignalService - Main orchestration service
 * Monitors all pairs, validates signals, sends alerts
 */
@Injectable()
export class SignalService implements OnModuleInit {
  private readonly logger = new Logger(SignalService.name);
  private redis: Redis | null = null;
  private readonly cooldownSeconds: number;
  private readonly maxAlertsPerHour: number;
  private readonly useRedis: boolean;
  
  // In-memory fallback for cooldown and rate limiting (if Redis unavailable)
  private inMemoryCooldowns = new Map<string, number>();
  private inMemoryRateLimit: { count: number; resetTime: number } = {
    count: 0,
    resetTime: Date.now() + 3600000, // 1 hour
  };

  constructor(
    private marketDataService: MarketDataService,
    private fundingStreamService: FundingStreamService,
    private signalValidator: SignalValidatorService,
    private scoringEngine: ScoringEngineService,
    private discordAlertService: DiscordAlertService,
    private configService: ConfigService,
    private indicatorService: IndicatorService,
    @Optional()
    @InjectRepository(SignalEntity)
    private signalRepository?: Repository<SignalEntity>,
    @Optional()
    @InjectRepository(FundingSnapshot)
    private fundingSnapshotRepository?: Repository<FundingSnapshot>,
  ) {
    this.useRedis = this.configService.get('ENABLE_REDIS', 'true') !== 'false';
    
    if (this.useRedis) {
      try {
        // Initialize Redis for cooldown tracking
        this.redis = new Redis({
          host: this.configService.get('REDIS_HOST', 'localhost'),
          port: this.configService.get('REDIS_PORT', 6379),
          password: this.configService.get('REDIS_PASSWORD', ''),
          db: this.configService.get('REDIS_DB', 0),
          retryStrategy: () => null, // Don't retry if connection fails
          maxRetriesPerRequest: 0,
        });

        this.redis.on('error', (error) => {
          this.logger.warn(
            `Redis connection error, falling back to in-memory storage: ${error.message}`,
          );
          this.redis = null;
        });
      } catch (error) {
        this.logger.warn(
          `Failed to initialize Redis, using in-memory storage: ${error.message}`,
        );
        this.redis = null;
      }
    }

    this.cooldownSeconds = this.configService.get<number>(
      'COOLDOWN_SECONDS',
      300,
    );
    this.maxAlertsPerHour = this.configService.get<number>(
      'MAX_ALERTS_PER_HOUR',
      20,
    );
  }

  async onModuleInit() {
    this.logger.log('SignalService initialized');
    
    // REAL-TIME: Subscribe to funding updates for immediate signal detection
    // This is the PRIMARY method - processes signals instantly when funding changes
    this.fundingStreamService.fundingUpdate$.subscribe(async (update) => {
      // Process immediately without any delay for real-time alerts
      await this.processSymbol(update.symbol);
    });

    // REAL-TIME: Also subscribe to price updates for RSI/momentum changes
    // This catches RSI confluence signals when price moves but funding hasn't changed yet
    this.marketDataService.priceUpdate$.subscribe(async (update) => {
      // Process on price updates too (for RSI confluence signals)
      await this.processSymbol(update.symbol);
    });
  }

  /**
   * Process a symbol for potential signals
   */
  private async processSymbol(symbol: string): Promise<void> {
    try {
      // Check cooldown
      if (await this.isInCooldown(symbol)) {
        return;
      }

      // Check global rate limit
      if (await this.isRateLimited()) {
        return;
      }

      // Validate signal
      const signal = await this.signalValidator.validateSignal(symbol);
      if (!signal) {
        return;
      }

      // Check score threshold
      if (!this.scoringEngine.meetsThreshold(signal.score)) {
        this.logger.debug(
          `Signal for ${symbol} scored ${signal.score}, below threshold`,
        );
        return;
      }

      // Save signal to database
      await this.saveSignal(signal);

      // Save funding snapshot
      await this.saveFundingSnapshot(symbol);

      // Send Discord alert
      await this.discordAlertService.sendAlert(signal);

      // Set cooldown
      await this.setCooldown(symbol);

      // Increment rate limit counter
      await this.incrementRateLimit();

      this.logger.log(
        `🎯 Signal sent: ${signal.symbol} ${signal.bias} | Score: ${signal.score} | RSI: ${signal.rsi?.toFixed(1)} | Funding: ${signal.fundingRate.toFixed(4)}%`,
      );
    } catch (error) {
      this.logger.error(`Error processing ${symbol}`, error);
    }
  }

  /**
   * Check if symbol is in cooldown period
   */
  private async isInCooldown(symbol: string): Promise<boolean> {
    if (this.redis) {
      try {
        const key = `cooldown:${symbol}`;
        const exists = await this.redis.exists(key);
        return exists === 1;
      } catch (error) {
        this.logger.warn('Redis error, falling back to in-memory', error);
        this.redis = null;
      }
    }

    // In-memory fallback
    const cooldownEnd = this.inMemoryCooldowns.get(symbol);
    if (cooldownEnd && cooldownEnd > Date.now()) {
      return true;
    }
    return false;
  }

  /**
   * Set cooldown for a symbol
   */
  private async setCooldown(symbol: string): Promise<void> {
    if (this.redis) {
      try {
        const key = `cooldown:${symbol}`;
        await this.redis.setex(key, this.cooldownSeconds, '1');
        return;
      } catch (error) {
        this.logger.warn('Redis error, falling back to in-memory', error);
        this.redis = null;
      }
    }

    // In-memory fallback
    this.inMemoryCooldowns.set(
      symbol,
      Date.now() + this.cooldownSeconds * 1000,
    );
    
    // Cleanup old entries periodically
    if (this.inMemoryCooldowns.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this.inMemoryCooldowns.entries()) {
        if (value < now) {
          this.inMemoryCooldowns.delete(key);
        }
      }
    }
  }

  /**
   * Check if global rate limit is exceeded
   */
  private async isRateLimited(): Promise<boolean> {
    if (this.redis) {
      try {
        const key = 'rate_limit:alerts';
        const count = await this.redis.get(key);
        return parseInt(count || '0') >= this.maxAlertsPerHour;
      } catch (error) {
        this.logger.warn('Redis error, falling back to in-memory', error);
        this.redis = null;
      }
    }

    // In-memory fallback
    const now = Date.now();
    if (now > this.inMemoryRateLimit.resetTime) {
      this.inMemoryRateLimit = {
        count: 0,
        resetTime: now + 3600000, // Reset after 1 hour
      };
    }
    return this.inMemoryRateLimit.count >= this.maxAlertsPerHour;
  }

  /**
   * Increment rate limit counter
   */
  private async incrementRateLimit(): Promise<void> {
    if (this.redis) {
      try {
        const key = 'rate_limit:alerts';
        const count = await this.redis.incr(key);
        
        // Set expiration to 1 hour if this is the first increment
        if (count === 1) {
          await this.redis.expire(key, 3600);
        }
        return;
      } catch (error) {
        this.logger.warn('Redis error, falling back to in-memory', error);
        this.redis = null;
      }
    }

    // In-memory fallback
    const now = Date.now();
    if (now > this.inMemoryRateLimit.resetTime) {
      this.inMemoryRateLimit = {
        count: 0,
        resetTime: now + 3600000,
      };
    }
    this.inMemoryRateLimit.count++;
  }

  /**
   * Save signal to database (optional - for history/analytics)
   */
  private async saveSignal(signal: Signal): Promise<void> {
    if (!this.signalRepository) {
      return; // Database disabled
    }
    
    try {
      const signalEntity = this.signalRepository.create({
        symbol: signal.symbol,
        signalType: signal.signalType,
        bias: signal.bias,
        fundingRate: signal.fundingRate,
        fundingDelta: signal.fundingDelta,
        rsi: signal.rsi,
        score: signal.score,
        price: signal.price,
        timeframe: signal.timeframe,
        context: signal.context,
        sentToDiscord: true,
      });

      await this.signalRepository.save(signalEntity);
    } catch (error) {
      // Database is optional - log but don't fail
      this.logger.warn(
        `Failed to save signal to database (database may be unavailable): ${error.message}`,
      );
    }
  }

  /**
   * Save funding snapshot for backtesting (optional)
   */
  private async saveFundingSnapshot(symbol: string): Promise<void> {
    if (!this.fundingSnapshotRepository) {
      return; // Database disabled
    }
    
    try {
      const marketData = this.marketDataService.getMarketData(symbol);
      const fundingData = this.marketDataService.getFundingData(symbol);
      const priceHistory = this.marketDataService.getPriceHistory(symbol);

      if (!marketData || !fundingData) {
        return;
      }

      // Calculate RSI for snapshot
      const { IndicatorService } = await import('../indicators/indicator.service');
      const indicatorService = new IndicatorService();
      const rsi = indicatorService.calculateRSI(priceHistory);

      const snapshot = this.fundingSnapshotRepository.create({
        symbol,
        fundingRate: fundingData.fundingRate,
        price: marketData.price,
        volume24h: marketData.volume24h,
        rsi: rsi || null,
        metadata: {
          timestamp: Date.now(),
        },
      });

      await this.fundingSnapshotRepository.save(snapshot);
    } catch (error) {
      // Database is optional - log but don't fail
      this.logger.debug(
        `Failed to save funding snapshot (database may be unavailable): ${error.message}`,
      );
    }
  }

  /**
   * Periodic scan of all symbols (backup to WebSocket)
   * Runs every 5 minutes as backup - primary detection is via WebSocket real-time
   * OPTIMIZED: Smart prioritization - scans high-priority symbols first
   */
  @Cron('*/5 * * * *') // Every 5 minutes instead of every minute (WebSocket is primary)
  async scanAllSymbols(): Promise<void> {
    const symbols = this.marketDataService.getAllSymbols();
    // Only log every 5 minutes to reduce verbosity
    const now = new Date();
    if (now.getMinutes() % 5 === 0) {
      this.logger.log(`📊 Periodic scan: Checking ${symbols.length} symbols for signals...`);
    }

    // OPTIMIZATION: Smart prioritization - separate high-priority symbols
    const { highPriority, normalPriority } = this.prioritizeSymbols(symbols);

    let signalsFound = 0;

    // Process high-priority symbols first (funding extrem, RSI extrem, etc.)
    if (highPriority.length > 0) {
      // Only log high-priority scan every 5 minutes to reduce verbosity
      if (now.getMinutes() % 5 === 0) {
        this.logger.log(`🎯 Scanning ${highPriority.length} high-priority symbols first (${normalPriority.length} normal priority)...`);
      }
      const highPriorityResults = await this.scanSymbolBatch(highPriority, 5); // Smaller batches for priority
      signalsFound += highPriorityResults;
    }

    // Process normal-priority symbols
    if (normalPriority.length > 0) {
      const normalResults = await this.scanSymbolBatch(normalPriority, 10);
      signalsFound += normalResults;
    }
    
    // Log if signals were found
    if (signalsFound > 0) {
      this.logger.log(`✅ Found ${signalsFound} signal(s) in periodic scan`);
    }
  }

  /**
   * Prioritize symbols based on funding rate, RSI, and volume
   * High priority: Funding extrem (≥±0.03%), RSI extrem (≥75 or ≤25), or recent volume spike
   */
  private prioritizeSymbols(symbols: string[]): {
    highPriority: string[];
    normalPriority: string[];
  } {
    const highPriority: string[] = [];
    const normalPriority: string[] = [];

    for (const symbol of symbols) {
      const fundingData = this.marketDataService.getFundingData(symbol);
      const marketData = this.marketDataService.getMarketData(symbol);
      const priceHistory = this.marketDataService.getPriceHistory(symbol);

      let isHighPriority = false;

      // Check funding extrem (≥±0.03%)
      if (fundingData && Math.abs(fundingData.fundingRate) >= 0.03) {
        isHighPriority = true;
      }

      // Check RSI extrem (if available)
      if (!isHighPriority && priceHistory.length >= 20) {
        const indicators = this.indicatorService.calculateAllIndicators(
          priceHistory,
          marketData?.volume24h || 0,
        );
        if (indicators.rsi !== null) {
          if (indicators.rsi >= 75 || indicators.rsi <= 25) {
            isHighPriority = true;
          }
        }
      }

      // Check funding velocity (rapid change)
      if (!isHighPriority) {
        const fundingVelocity = this.fundingStreamService.getFundingVelocity(symbol);
        if (Math.abs(fundingVelocity) > 0.0001) {
          // Rapid funding change
          isHighPriority = true;
        }
      }

      if (isHighPriority) {
        highPriority.push(symbol);
      } else {
        normalPriority.push(symbol);
      }
    }

    return { highPriority, normalPriority };
  }

  /**
   * Scan a batch of symbols
   * OPTIMIZED: Sequential processing of signals to avoid spam
   */
  private async scanSymbolBatch(
    symbols: string[],
    batchSize: number,
  ): Promise<number> {
    let signalsFound = 0;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      // Process batch in parallel for maximum speed (real-time detection)
      const results = await Promise.all(
        batch.map(async (symbol) => {
          const signal = await this.signalValidator.validateSignal(symbol);
          if (signal && this.scoringEngine.meetsThreshold(signal.score)) {
            // Process immediately - cooldown per symbol prevents spam
            await this.processSymbol(symbol);
            return true;
          }
          return false;
        }),
      );

      signalsFound += results.filter((r) => r).length;

      // Small delay between batches
      if (i + batchSize < symbols.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return signalsFound;
  }
}