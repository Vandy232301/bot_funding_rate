import { Injectable, Logger } from '@nestjs/common';
import { IndicatorData } from '../common/interfaces/market-data.interface';

/**
 * IndicatorService - Calculates technical indicators
 * RSI, Momentum, Volume analysis
 */
@Injectable()
export class IndicatorService {
  private readonly logger = new Logger(IndicatorService.name);

  /**
   * Calculate RSI (Relative Strength Index)
   * @param prices Array of closing prices (oldest first)
   * @param period RSI period (default: 14)
   * @returns RSI value (0-100) or null if insufficient data
   */
  calculateRSI(prices: number[], period: number = 14): number | null {
    if (prices.length < period + 1) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI using Wilder's smoothing method
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      return 100; // All gains, no losses
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 100) / 100;
  }

  /**
   * Calculate momentum (rate of price change)
   * @param prices Array of closing prices
   * @param period Period for momentum calculation (default: 10)
   * @returns Momentum value (positive = bullish, negative = bearish)
   */
  calculateMomentum(prices: number[], period: number = 10): number | null {
    if (prices.length < period + 1) {
      return null;
    }

    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - period - 1];
    
    // Calculate percentage change
    const momentum = ((currentPrice - pastPrice) / pastPrice) * 100;
    
    return Math.round(momentum * 100) / 100;
  }

  /**
   * Detect volume spike
   * @param currentVolume Current 24h volume
   * @param averageVolume Average volume (from historical data)
   * @returns Volume spike multiplier (1.0 = no spike, >1.5 = significant spike)
   */
  calculateVolumeSpike(currentVolume: number, averageVolume: number): number {
    if (averageVolume === 0) return 1.0;
    
    const spike = currentVolume / averageVolume;
    return Math.round(spike * 100) / 100;
  }

  /**
   * Calculate all indicators for a symbol
   * @param prices Price history
   * @param currentVolume Current 24h volume
   * @param averageVolume Average volume
   * @returns IndicatorData object
   */
  calculateAllIndicators(
    prices: number[],
    currentVolume?: number,
    averageVolume?: number,
  ): IndicatorData {
    const rsi = this.calculateRSI(prices, 14);
    const momentum = this.calculateMomentum(prices, 10);
    
    let volumeSpike: number | undefined;
    if (currentVolume !== undefined && averageVolume !== undefined) {
      volumeSpike = this.calculateVolumeSpike(currentVolume, averageVolume);
    }

    return {
      rsi: rsi || undefined,
      momentum: momentum || undefined,
      volumeSpike,
    };
  }

  /**
   * Determine if price action shows exhaustion
   * Exhaustion = strong move with RSI in extreme zone
   */
  isExhaustion(rsi: number | null, momentum: number | null): boolean {
    if (!rsi || !momentum) return false;
    
    // Exhaustion: Strong momentum with extreme RSI
    const strongMomentum = Math.abs(momentum) > 2.0; // >2% move
    const extremeRSI = rsi >= 70 || rsi <= 30;
    
    return strongMomentum && extremeRSI;
  }

  /**
   * Determine if price action shows expansion
   * Expansion = strong move with RSI in healthy zone
   */
  isExpansion(rsi: number | null, momentum: number | null): boolean {
    if (!rsi || !momentum) return false;
    
    // Expansion: Strong momentum with RSI in 40-60 range
    const strongMomentum = Math.abs(momentum) > 1.5;
    const healthyRSI = rsi >= 40 && rsi <= 60;
    
    return strongMomentum && healthyRSI;
  }
}