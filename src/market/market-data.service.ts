import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BybitService } from '../bybit/bybit.service';
import { BybitWebSocketService } from '../bybit/bybit.websocket.service';
import { MarketData, FundingData, PriceData } from '../common/interfaces/market-data.interface';
import { Subject, merge } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * MarketDataService - Aggregates and manages real-time market data
 * Combines WebSocket streams with REST fallback
 */
@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);
  
  // In-memory cache for current market state
  private marketDataCache = new Map<string, MarketData>();
  private fundingDataCache = new Map<string, FundingData>();
  private priceHistoryCache = new Map<string, number[]>(); // For RSI calculation
  
  // Observables for consumers
  public marketData$ = new Subject<MarketData>();
  public fundingData$ = new Subject<FundingData>();
  public priceUpdate$ = new Subject<PriceData>();

  constructor(
    private bybitService: BybitService,
    private bybitWsService: BybitWebSocketService,
  ) {}

  async onModuleInit() {
    // Subscribe to WebSocket streams
    this.bybitWsService.fundingRate$.subscribe((data) => {
      this.fundingDataCache.set(data.symbol, data);
      this.fundingData$.next(data);
    });

    this.bybitWsService.priceUpdate$.subscribe((data) => {
      const marketData = this.marketDataCache.get(data.symbol);
      if (marketData) {
        marketData.price = data.price;
        marketData.timestamp = data.timestamp;
      }
      this.priceUpdate$.next(data);
      
      // Update price history for RSI
      this.updatePriceHistory(data.symbol, data.price);
    });

    // Initialize all pairs
    await this.initializePairs();
  }

  /**
   * Initialize monitoring for all USDT perpetual pairs (already filtered by quality)
   */
  private async initializePairs(): Promise<void> {
    const pairs = this.bybitService.getUsdtPerpetualPairs();
    this.logger.log(`🔄 Initializing ${pairs.length} quality pairs...`);

    // Subscribe to WebSocket for all pairs (batch subscription)
    if (this.bybitWsService.isWsConnected()) {
      this.bybitWsService.subscribeSymbols(pairs);
      this.logger.log(`📡 Subscribed to ${pairs.length} pairs via WebSocket`);
    }

    // Fetch initial data via REST in batches (rate limit friendly)
    const batchSize = 20; // Process 20 pairs at a time
    const batches = [];
    
    for (let i = 0; i < pairs.length; i += batchSize) {
      batches.push(pairs.slice(i, i + batchSize));
    }

    this.logger.log(`📦 Fetching initial data in ${batches.length} batches...`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      // Process batch in parallel
      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const [marketData, fundingData] = await Promise.all([
              this.bybitService.getMarketData(symbol),
              this.bybitService.getFundingRate(symbol),
            ]);

            if (marketData) {
              this.marketDataCache.set(symbol, marketData);
            }

            if (fundingData) {
              this.fundingDataCache.set(symbol, fundingData);
            }

            // Load initial price history for RSI
            await this.loadPriceHistory(symbol);
          } catch (error) {
            this.logger.warn(`Failed to initialize ${symbol}:`, error);
          }
        }),
      );

      // Rate limit protection: wait between batches
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms delay between batches
      }
    }

    this.logger.log(
      `✅ Initialized ${this.marketDataCache.size} pairs with market data, ${this.fundingDataCache.size} with funding data`,
    );
  }

  /**
   * Load price history for RSI calculation
   */
  private async loadPriceHistory(symbol: string): Promise<void> {
    try {
      const prices = await this.bybitService.getKlines(symbol, '1', 100);
      if (prices.length > 0) {
        this.priceHistoryCache.set(symbol, prices);
      }
    } catch (error) {
      this.logger.error(`Failed to load price history for ${symbol}`, error);
    }
  }

  /**
   * Update price history (rolling window)
   */
  private updatePriceHistory(symbol: string, price: number): void {
    const history = this.priceHistoryCache.get(symbol) || [];
    history.push(price);
    
    // Keep only last 100 prices
    if (history.length > 100) {
      history.shift();
    }
    
    this.priceHistoryCache.set(symbol, history);
  }

  /**
   * Get current market data for a symbol
   */
  getMarketData(symbol: string): MarketData | null {
    return this.marketDataCache.get(symbol) || null;
  }

  /**
   * Get current funding data for a symbol
   */
  getFundingData(symbol: string): FundingData | null {
    return this.fundingDataCache.get(symbol) || null;
  }

  /**
   * Get price history for a symbol (for RSI)
   */
  getPriceHistory(symbol: string): number[] {
    return this.priceHistoryCache.get(symbol) || [];
  }

  /**
   * Get all monitored symbols
   */
  getAllSymbols(): string[] {
    return Array.from(this.marketDataCache.keys());
  }

  /**
   * Refresh data for a symbol (REST fallback)
   */
  async refreshSymbol(symbol: string): Promise<void> {
    try {
      const [marketData, fundingData] = await Promise.all([
        this.bybitService.getMarketData(symbol),
        this.bybitService.getFundingRate(symbol),
      ]);

      if (marketData) {
        this.marketDataCache.set(symbol, marketData);
        this.marketData$.next(marketData);
      }

      if (fundingData) {
        this.fundingDataCache.set(symbol, fundingData);
        this.fundingData$.next(fundingData);
      }
    } catch (error) {
      this.logger.error(`Failed to refresh ${symbol}`, error);
    }
  }
}