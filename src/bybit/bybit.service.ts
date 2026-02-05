import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { FundingData, MarketData } from '../common/interfaces/market-data.interface';

@Injectable()
export class BybitService implements OnModuleInit {
  private readonly logger = new Logger(BybitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly testnet: boolean;
  private readonly baseUrl: string;
  private readonly client: AxiosInstance;
  private usdtPerpetualPairs: string[] = [];

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BYBIT_API_KEY', '');
    this.apiSecret = this.configService.get<string>('BYBIT_API_SECRET', '');
    this.testnet = this.configService.get<boolean>('BYBIT_TESTNET', false);
    this.baseUrl = this.testnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  async onModuleInit() {
    await this.loadUsdtPerpetualPairs();
  }

  /**
   * Fetch all USDT perpetual pairs from Bybit with quality filters
   * 
   * Bot monitors tokens that meet ALL criteria:
   * - Listed on Bybit as USDT perpetuals
   * - Volume 24h ≥ $1M (configurable via MIN_VOLUME_24H_USDT)
   * - Open Interest ≥ $500k (configurable via MIN_OPEN_INTEREST_USDT)
   * - Not in blacklist
   * - Have sufficient funding rate data
   */
  async loadUsdtPerpetualPairs(): Promise<void> {
    try {
      this.logger.log('📡 Fetching USDT perpetual pairs from Bybit...');
      
      // Step 1: Get all instruments
      const instrumentsResponse = await this.client.get('/v5/market/instruments-info', {
        params: {
          category: 'linear',
        },
      });

      if (instrumentsResponse.data?.retCode !== 0) {
        throw new Error(`Bybit API error: ${instrumentsResponse.data?.retMsg}`);
      }

      // Filter basic: USDT + Trading
      const allInstruments = instrumentsResponse.data.result.list.filter(
        (instrument: any) => 
          instrument.settleCoin === 'USDT' && 
          instrument.status === 'Trading'
      );

      this.logger.log(`📊 Found ${allInstruments.length} USDT perpetual pairs (before filters)`);

      // Step 2: Load blacklist
      const blacklistStr = this.configService.get<string>('BLACKLIST_SYMBOLS', '');
      const blacklist = blacklistStr
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0);
      
      if (blacklist.length > 0) {
        this.logger.log(`🚫 Blacklist: ${blacklist.length} symbols excluded`);
      }

      // Step 3: Fetch tickers in batches to get volume and open interest
      const minVolume24h = this.configService.get<number>('MIN_VOLUME_24H_USDT', 1000000); // $1M USDT default (relaxed for more pairs)
      const minOpenInterest = this.configService.get<number>('MIN_OPEN_INTEREST_USDT', 500000); // $500k USDT default (relaxed for more pairs)
      const minPrice = this.configService.get<number>('MIN_PRICE_USDT', 0.0001); // Avoid dust
      const maxPrice = this.configService.get<number>('MAX_PRICE_USDT', 100000); // Avoid very expensive

      this.logger.log(`🔍 Applying quality filters:`);
      this.logger.log(`   - Min Volume 24h: $${minVolume24h.toLocaleString()}`);
      this.logger.log(`   - Min Open Interest: $${minOpenInterest.toLocaleString()}`);
      this.logger.log(`   - Price range: $${minPrice} - $${maxPrice.toLocaleString()}`);
      if (blacklist.length > 0) {
        this.logger.log(`   - Blacklist: ${blacklist.join(', ')}`);
      }

      // Fetch all tickers at once (Bybit supports this)
      const tickersResponse = await this.client.get('/v5/market/tickers', {
        params: {
          category: 'linear',
        },
      });

      if (tickersResponse.data?.retCode !== 0) {
        this.logger.warn('Failed to fetch tickers, using all pairs without filters');
        this.usdtPerpetualPairs = allInstruments.map((i: any) => i.symbol);
        return;
      }

      // Create a map of symbol -> ticker data
      const tickerMap = new Map<string, any>();
      tickersResponse.data.result.list.forEach((ticker: any) => {
        tickerMap.set(ticker.symbol, ticker);
      });

      // Step 4: Apply quality filters
      const filteredPairs: string[] = [];
      let filteredCount = 0;
      let blacklistedCount = 0;
      let noFundingDataCount = 0;

      for (const instrument of allInstruments) {
        const symbol = instrument.symbol;
        const ticker = tickerMap.get(symbol);
        
        if (!ticker) {
          continue; // Skip if no ticker data
        }

        // Check blacklist first
        if (blacklist.includes(symbol.toUpperCase())) {
          blacklistedCount++;
          continue;
        }

        const volume24h = parseFloat(ticker.turnover24h || '0'); // 24h turnover in USDT
        const openInterestValue = parseFloat(ticker.openInterestValue || '0'); // Open interest value in USDT
        const openInterest = parseFloat(ticker.openInterest || '0'); // Open interest count (fallback)
        const price = parseFloat(ticker.lastPrice || '0');
        const fundingRate = ticker.fundingRate; // Check if funding rate exists

        // Apply filters
        const passesVolume = volume24h >= minVolume24h;
        const passesOI = openInterestValue >= minOpenInterest || (openInterestValue === 0 && openInterest >= minOpenInterest / 1000); // Use OI value, fallback to count
        const passesPrice = price >= minPrice && price <= maxPrice;
        const hasFundingData = fundingRate !== undefined && fundingRate !== null && fundingRate !== '';

        if (passesVolume && passesOI && passesPrice && hasFundingData) {
          filteredPairs.push(symbol);
        } else {
          filteredCount++;
          if (!hasFundingData) {
            noFundingDataCount++;
          }
          if (filteredCount <= 5) {
            // Log first few filtered out for debugging
            const reasons: string[] = [];
            if (!passesVolume) reasons.push(`vol=$${volume24h.toFixed(0)} < $${minVolume24h.toLocaleString()}`);
            if (!passesOI) reasons.push(`OI=$${openInterestValue.toFixed(0)} < $${minOpenInterest.toLocaleString()}`);
            if (!passesPrice) reasons.push(`price=$${price} out of range`);
            if (!hasFundingData) reasons.push('no funding data');
            
            this.logger.debug(
              `❌ Filtered out ${symbol}: ${reasons.join(', ')}`
            );
          }
        }
      }

      this.usdtPerpetualPairs = filteredPairs;
      
      this.logger.log(
        `✅ Loaded ${this.usdtPerpetualPairs.length} quality USDT perpetual pairs`,
      );
      this.logger.log(
        `📊 Filtering stats: ${filteredCount} filtered out (${noFundingDataCount} no funding data, ${blacklistedCount} blacklisted)`,
      );
      if (this.usdtPerpetualPairs.length > 0) {
        this.logger.log(
          `📈 Top 5 by volume: ${this.getTopPairsByVolume(tickerMap, filteredPairs, 5).join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to load perpetual pairs', error);
      throw error;
    }
  }

  /**
   * Get top pairs by volume for logging
   */
  private getTopPairsByVolume(
    tickerMap: Map<string, any>,
    pairs: string[],
    limit: number = 5,
  ): string[] {
    return pairs
      .map((symbol) => ({
        symbol,
        volume: parseFloat(tickerMap.get(symbol)?.turnover24h || '0'),
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit)
      .map((item) => `${item.symbol} ($${(item.volume / 1000).toFixed(0)}k)`);
  }

  /**
   * Get all USDT perpetual pairs
   */
  getUsdtPerpetualPairs(): string[] {
    return [...this.usdtPerpetualPairs];
  }

  /**
   * Fetch current funding rate for a symbol
   */
  async getFundingRate(symbol: string): Promise<FundingData | null> {
    try {
      const response = await this.client.get('/v5/market/tickers', {
        params: {
          category: 'linear',
          symbol,
        },
      });

      if (response.data?.retCode === 0 && response.data.result?.list?.length > 0) {
        const ticker = response.data.result.list[0];
        return {
          symbol,
          fundingRate: parseFloat(ticker.fundingRate) * 100, // Convert to percentage
          fundingRateTimestamp: parseInt(ticker.nextFundingTime),
          nextFundingTime: parseInt(ticker.nextFundingTime),
        };
      }
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch funding rate for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Fetch market data for a symbol
   */
  async getMarketData(symbol: string): Promise<MarketData | null> {
    try {
      const response = await this.client.get('/v5/market/tickers', {
        params: {
          category: 'linear',
          symbol,
        },
      });

      if (response.data?.retCode === 0 && response.data.result?.list?.length > 0) {
        const ticker = response.data.result.list[0];
        return {
          symbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.turnover24h),
          timestamp: Date.now(),
        };
      }
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch market data for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Fetch kline data for RSI calculation
   */
  async getKlines(
    symbol: string,
    interval: '1' | '5' = '1',
    limit: number = 100,
  ): Promise<number[]> {
    try {
      const response = await this.client.get('/v5/market/kline', {
        params: {
          category: 'linear',
          symbol,
          interval,
          limit,
        },
      });

      if (response.data?.retCode === 0 && response.data.result?.list?.length > 0) {
        // Return closing prices (index 4 in Bybit kline format)
        return response.data.result.list
          .reverse() // Oldest first
          .map((kline: string[]) => parseFloat(kline[4]));
      }
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch klines for ${symbol}`, error);
      return [];
    }
  }
}