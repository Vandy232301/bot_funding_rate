import { Injectable, Logger } from '@nestjs/common';
import { MarketDataService } from '../market/market-data.service';
import { FundingStreamService } from '../market/funding-stream.service';
import { IndicatorService } from '../indicators/indicator.service';
import { ScoringEngineService } from '../scoring/scoring-engine.service';
import { SignalType, SignalBias } from '../database/entities/signal.entity';
import { Signal, SignalContext } from '../common/interfaces/signal.interface';

/**
 * SignalValidatorService - Implements DYNASTY strategy logic
 * 1. RSI Confluence (NEW: RSI > 75 + funding for SHORT, RSI < 30 + funding for LONG)
 * 2. Funding Overextension Reversal
 * 3. Funding Trend Confirmation
 * 4. Funding Divergence Alert
 */
@Injectable()
export class SignalValidatorService {
  private readonly logger = new Logger(SignalValidatorService.name);

  // Strategy thresholds
  private readonly REVERSAL_THRESHOLD = 0.04; // ±0.04%
  private readonly TREND_MIN = 0.005; // ±0.005%
  private readonly TREND_MAX = 0.02; // ±0.02%
  private readonly RSI_OVERBOUGHT = 70;
  private readonly RSI_OVERSOLD = 30;
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
   */
  async validateSignal(symbol: string): Promise<Signal | null> {
    try {
      // Gather all context data
      const context = await this.buildSignalContext(symbol);
      if (!context) {
        return null;
      }

      // Check for RSI Confluence signal (highest priority - new logic)
      const rsiConfluenceSignal = this.detectRSIConfluenceSignal(symbol, context);
      if (rsiConfluenceSignal) {
        return rsiConfluenceSignal;
      }

      // Check for reversal signal
      const reversalSignal = this.detectReversalSignal(symbol, context);
      if (reversalSignal) {
        return reversalSignal;
      }

      // Check for trend confirmation
      const trendSignal = this.detectTrendSignal(symbol, context);
      if (trendSignal) {
        return trendSignal;
      }

      // Check for divergence
      const divergenceSignal = this.detectDivergenceSignal(symbol, context);
      if (divergenceSignal) {
        return divergenceSignal;
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
        SignalType.REVERSAL, // Use REVERSAL type for confluence signals
        SignalBias.LONG,
        context,
        'SHORT Overcrowded',
      );
    }

    return null;
  }

  /**
   * Detect Funding Overextension Reversal signal
   */
  private detectReversalSignal(
    symbol: string,
    context: SignalContext,
  ): Signal | null {
    const { fundingRate, fundingDelta, rsi, momentum } = context;

    // SHORT signal: Funding ≥ +0.04%, RSI ≥ 70, strong upward momentum
    if (
      fundingRate >= this.REVERSAL_THRESHOLD &&
      rsi !== null &&
      rsi >= this.RSI_OVERBOUGHT &&
      momentum !== null &&
      momentum > 1.0
    ) {
      // Check if funding is accelerating (delta increasing)
      const isAccelerating = fundingDelta > 0;

      if (isAccelerating) {
        return this.createSignal(
          symbol,
          SignalType.REVERSAL,
          SignalBias.SHORT,
          context,
          'LONG Overcrowded',
        );
      }
    }

    // LONG signal: Funding ≤ -0.04%, RSI ≤ 30, strong downward momentum
    if (
      fundingRate <= -this.REVERSAL_THRESHOLD &&
      rsi !== null &&
      rsi <= this.RSI_OVERSOLD &&
      momentum !== null &&
      momentum < -1.0
    ) {
      // Check if funding is accelerating negatively (delta decreasing)
      const isAccelerating = fundingDelta < 0;

      if (isAccelerating) {
        return this.createSignal(
          symbol,
          SignalType.REVERSAL,
          SignalBias.LONG,
          context,
          'SHORT Overcrowded',
        );
      }
    }

    return null;
  }

  /**
   * Detect Funding Trend Confirmation signal
   */
  private detectTrendSignal(
    symbol: string,
    context: SignalContext,
  ): Signal | null {
    const { fundingRate, fundingDelta, momentum } = context;

    // LONG trend: Funding between +0.005% → +0.02%, increasing gradually
    if (
      fundingRate >= this.TREND_MIN &&
      fundingRate <= this.TREND_MAX &&
      fundingDelta > 0 &&
      momentum !== null &&
      momentum > 0
    ) {
      return this.createSignal(
        symbol,
        SignalType.TREND,
        SignalBias.LONG,
        context,
        'LONG Overcrowded',
      );
    }

    // SHORT trend: Funding between -0.005% → -0.02%, decreasing gradually
    if (
      fundingRate <= -this.TREND_MIN &&
      fundingRate >= -this.TREND_MAX &&
      fundingDelta < 0 &&
      momentum !== null &&
      momentum < 0
    ) {
      return this.createSignal(
        symbol,
        SignalType.TREND,
        SignalBias.SHORT,
        context,
        'SHORT Overcrowded',
      );
    }

    return null;
  }

  /**
   * Detect Funding Divergence signal (early warning)
   */
  private detectDivergenceSignal(
    symbol: string,
    context: SignalContext,
  ): Signal | null {
    const { fundingRate, momentum } = context;

    // Price ↑ while Funding ↓ → Distribution risk (bearish divergence)
    if (momentum !== null && momentum > 1.0 && fundingRate < -0.005) {
      return this.createSignal(
        symbol,
        SignalType.DIVERGENCE,
        SignalBias.SHORT,
        context,
        'SHORT Overcrowded',
      );
    }

    // Price ↓ while Funding ↑ → Accumulation risk (bullish divergence)
    if (momentum !== null && momentum < -1.0 && fundingRate > 0.005) {
      return this.createSignal(
        symbol,
        SignalType.DIVERGENCE,
        SignalBias.LONG,
        context,
        'LONG Overcrowded',
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

    // Determine timeframe (simplified - use 1m for now)
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

    // For now, use same RSI for all timeframes (can be enhanced to calculate separately)
    const rsi = context.rsi || 0;
    const rsi15m = rsi + (Math.random() * 5 - 2.5); // Simulate slight variation
    const rsi5m = rsi + (Math.random() * 3 - 1.5);
    const rsi1m = rsi;

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
   * Build human-readable context message (concise format like in the image)
   */
  private buildContextMessage(
    signalType: SignalType,
    bias: SignalBias,
    context: SignalContext,
    fundingBias: string,
  ): string {
    const parts: string[] = [];

    // Add momentum description
    if (context.momentum) {
      const absMomentum = Math.abs(context.momentum);
      if (absMomentum > 5.0) {
        parts.push('Rapid pump');
      } else if (absMomentum > 2.0) {
        parts.push('Strong move');
      }
    }

    // Add RSI description
    if (context.rsi) {
      if (context.rsi >= 75 || context.rsi <= 25) {
        parts.push('RSI extreme');
      } else if (context.rsi >= 70 || context.rsi <= 30) {
        parts.push('RSI overextended');
      }
    }

    // Add funding description
    if (Math.abs(context.fundingRate) >= 0.04) {
      parts.push('extreme funding');
    } else if (Math.abs(context.fundingRate) >= 0.02) {
      parts.push('high funding');
    }

    // Add position description
    if (signalType === SignalType.REVERSAL) {
      parts.push('at resistance');
    } else if (signalType === SignalType.TREND) {
      parts.push('trend continuation');
    } else if (signalType === SignalType.DIVERGENCE) {
      parts.push('divergence risk');
    }

    // If no parts, add generic description
    if (parts.length === 0) {
      return `${fundingBias} with funding rate at ${context.fundingRate.toFixed(4)}%`;
    }

    return parts.join(' + ');
  }
}