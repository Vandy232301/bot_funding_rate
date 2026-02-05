import { Injectable, Logger } from '@nestjs/common';
import { MarketDataService } from '../market/market-data.service';
import { FundingStreamService } from '../market/funding-stream.service';
import { IndicatorService } from '../indicators/indicator.service';
import { ScoringEngineService } from '../scoring/scoring-engine.service';
import { SignalType, SignalBias } from '../database/entities/signal.entity';
import { Signal, SignalContext } from '../common/interfaces/signal.interface';

/**
 * SignalValidatorService - Simplified DYNASTY strategy logic
 * Only RSI Confluence signals:
 * - SHORT: RSI > 75 + Funding Rate > 0.01%
 * - LONG: RSI < 30 + Funding Rate < -0.01%
 * Monitoring on 1m timeframe
 */
@Injectable()
export class SignalValidatorService {
  private readonly logger = new Logger(SignalValidatorService.name);

  // Strategy thresholds - Only RSI Confluence
  private readonly RSI_CONFLUENCE_SHORT = 75; // RSI > 75 for SHORT confluence
  private readonly RSI_CONFLUENCE_LONG = 30; // RSI < 30 for LONG confluence
  private readonly FUNDING_FACILITATE_SHORT = 0.01; // Funding > 0.01% facilitates SHORT
  private readonly FUNDING_FACILITATE_LONG = -0.01; // Funding < -0.01% facilitates LONG

  constructor(
    private marketDataService: MarketDataService,
    private fundingStreamService: FundingStreamService,
    private indicatorService: IndicatorService,
    private scoringEngine: ScoringEngineService,
  ) {}

  /**
   * Validate and detect signals for a symbol
   * Simplified: Only RSI Confluence signals (Funding Rate + RSI)
   */
  async validateSignal(symbol: string): Promise<Signal | null> {
    try {
      // Gather all context data
      const context = await this.buildSignalContext(symbol);
      if (!context) {
        return null;
      }

      // Only check for RSI Confluence signal (Funding Rate + RSI)
      const rsiConfluenceSignal = this.detectRSIConfluenceSignal(symbol, context);
      if (rsiConfluenceSignal) {
        return rsiConfluenceSignal;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error validating signal for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Build signal context from market data
   * OPTIMIZED: Early exit if funding rate is not extreme enough
   */
  private async buildSignalContext(symbol: string): Promise<SignalContext | null> {
    const marketData = this.marketDataService.getMarketData(symbol);
    const fundingData = this.marketDataService.getFundingData(symbol);

    if (!marketData || !fundingData) {
      return null;
    }

    // OPTIMIZATION: Early exit - check funding rate first
    // If funding is too normal (< ±0.01%), skip expensive RSI/momentum calculations
    const absFunding = Math.abs(fundingData.fundingRate);
    const MIN_FUNDING_FOR_DETAILED_ANALYSIS = 0.01; // ±0.01%

    const priceHistory = this.marketDataService.getPriceHistory(symbol);
    if (priceHistory.length < 20) {
      return null;
    }

    // If funding is very normal, only do basic check (for RSI Confluence which needs minimal funding)
    if (absFunding < MIN_FUNDING_FOR_DETAILED_ANALYSIS) {
      // Still calculate RSI for RSI Confluence signals (needs RSI > 75 or < 30)
      const indicators = this.indicatorService.calculateAllIndicators(
        priceHistory,
        marketData.volume24h,
      );

      // Only proceed if RSI is extreme (for RSI Confluence)
      if (indicators.rsi === null || (indicators.rsi <= 75 && indicators.rsi >= 25)) {
        // RSI not extreme and funding not extreme = skip detailed analysis
        return null;
      }
    }

    // Calculate indicators (only if funding is extreme or RSI is extreme)
    const indicators = this.indicatorService.calculateAllIndicators(
      priceHistory,
      marketData.volume24h,
    );

    // Get funding delta
    const fundingDelta = this.fundingStreamService.getFundingDelta(symbol);
    const fundingVelocity = this.fundingStreamService.getFundingVelocity(symbol);

    // Get BTC context (if enabled)
    let btcContext;
    const enableBtcContext = process.env.ENABLE_BTC_CONTEXT !== 'false';
    if (enableBtcContext) {
      const btcMarketData = this.marketDataService.getMarketData('BTCUSDT');
      const btcFundingData = this.marketDataService.getFundingData('BTCUSDT');
      if (btcMarketData && btcFundingData) {
        btcContext = {
          price: btcMarketData.price,
          fundingRate: btcFundingData.fundingRate,
        };
      }
    }

    return {
      fundingRate: fundingData.fundingRate,
      fundingDelta,
      rsi: indicators.rsi || null,
      price: marketData.price,
      volume24h: marketData.volume24h,
      momentum: indicators.momentum || null,
      btcContext,
    };
  }

  /**
   * Detect RSI Confluence signal
   * SHORT: RSI > 75 + Funding Rate > 0.01% (facilitates SHORT)
   * LONG: RSI < 30 + Funding Rate < -0.01% (facilitates LONG)
   */
  private detectRSIConfluenceSignal(
    symbol: string,
    context: SignalContext,
  ): Signal | null {
    const { fundingRate, rsi } = context;

    // SHORT signal: RSI > 75 + Funding Rate > 0.01% (positive funding facilitates SHORT)
    if (
      rsi !== null &&
      rsi > this.RSI_CONFLUENCE_SHORT &&
      fundingRate > this.FUNDING_FACILITATE_SHORT
    ) {
      return this.createSignal(
        symbol,
        SignalType.REVERSAL, // Use REVERSAL type for confluence signals
        SignalBias.SHORT,
        context,
        'LONG Overcrowded',
      );
    }

    // LONG signal: RSI < 30 + Funding Rate < -0.01% (negative funding facilitates LONG)
    if (
      rsi !== null &&
      rsi < this.RSI_CONFLUENCE_LONG &&
      fundingRate < this.FUNDING_FACILITATE_LONG
    ) {
      return this.createSignal(
        symbol,
        SignalType.REVERSAL, // Signal type (REVERSAL for all confluence signals)
        SignalBias.LONG,
        context,
        'SHORT Overcrowded',
      );
    }

    return null;
  }


  /**
   * Create signal object
   */
  private createSignal(
    symbol: string,
    signalType: SignalType,
    bias: SignalBias,
    context: SignalContext,
    fundingBias: 'LONG Overcrowded' | 'SHORT Overcrowded',
  ): Signal {
    // Calculate score
    const score = this.scoringEngine.calculateScore(context);

    // Determine momentum state
    const isExhaustion = this.indicatorService.isExhaustion(
      context.rsi,
      context.momentum,
    );
    const momentum = isExhaustion ? 'Exhaustion' : 'Expansion';

    // Always use 1m timeframe for monitoring
    const timeframe = '1m';

    // Build context message
    const contextMessage = this.buildContextMessage(
      signalType,
      bias,
      context,
      fundingBias,
    );

    // Calculate movement from momentum (simplified - can be enhanced with actual price history)
    const momentumValue = context.momentum || 0;
    const movementUp = Math.abs(momentumValue > 0 ? momentumValue : 2.0);
    const movementDown = Math.abs(momentumValue < 0 ? Math.abs(momentumValue) : 2.0);

    // Use RSI from 1m timeframe only (simplified monitoring)
    const rsi = context.rsi || 0;
    const rsi1m = rsi;
    const rsi5m = rsi; // Same as 1m for now
    const rsi15m = rsi; // Same as 1m for now

    return {
      symbol,
      signalType,
      bias,
      fundingRate: context.fundingRate,
      fundingDelta: context.fundingDelta || 0,
      rsi: rsi,
      rsi15m: Math.max(0, Math.min(100, rsi15m)),
      rsi5m: Math.max(0, Math.min(100, rsi5m)),
      rsi1m: Math.max(0, Math.min(100, rsi1m)),
      score,
      price: context.price,
      timeframe,
      context: contextMessage,
      momentum,
      fundingBias,
      movement: {
        up: movementUp,
        down: movementDown,
      },
    };
  }

  /**
   * Build human-readable context message (simplified for RSI Confluence only)
   */
  private buildContextMessage(
    signalType: SignalType,
    bias: SignalBias,
    context: SignalContext,
    fundingBias: string,
  ): string {
    const parts: string[] = [];

    // Add RSI description (always extreme for confluence signals)
    if (context.rsi) {
      if (context.rsi >= 75 || context.rsi <= 25) {
        parts.push('RSI extreme');
      }
    }

    // Add funding description
    if (Math.abs(context.fundingRate) >= 0.02) {
      parts.push('high funding');
    } else {
      parts.push('funding confluence');
    }

    // If no parts, add generic description
    if (parts.length === 0) {
      return `RSI + Funding confluence (${context.fundingRate.toFixed(4)}%)`;
    }

    return parts.join(' + ');
  }
}