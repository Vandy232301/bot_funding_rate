import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignalContext } from '../common/interfaces/signal.interface';

/**
 * ScoringEngineService - DYNASTY Scoring System
 * Weighted scoring (0-100) based on multiple factors
 * Only signals with score ≥ 75 are sent to Discord
 */
@Injectable()
export class ScoringEngineService {
  private readonly logger = new Logger(ScoringEngineService.name);
  private readonly minScoreThreshold: number;

  // Scoring weights (must sum to 100%)
  private readonly WEIGHTS = {
    FUNDING_EXTREMITY: 40,
    FUNDING_DELTA: 20,
    RSI_MOMENTUM: 20,
    VOLUME_SPIKE: 10,
    BTC_CONTEXT: 10,
  };

  constructor(private configService: ConfigService) {
    this.minScoreThreshold = this.configService.get<number>(
      'MIN_SCORE_THRESHOLD',
      75,
    );
  }

  /**
   * Calculate total score for a signal context
   */
  calculateScore(context: SignalContext): number {
    const scores = {
      fundingExtremity: this.scoreFundingExtremity(context.fundingRate),
      fundingDelta: this.scoreFundingDelta(
        context.fundingRate,
        context.fundingDelta,
      ),
      rsiMomentum: this.scoreRSIMomentum(context.rsi, context.momentum),
      volumeSpike: this.scoreVolumeSpike(context.volume24h),
      btcContext: this.scoreBTCContext(context.btcContext),
    };

    // Calculate weighted score
    const totalScore =
      scores.fundingExtremity * (this.WEIGHTS.FUNDING_EXTREMITY / 100) +
      scores.fundingDelta * (this.WEIGHTS.FUNDING_DELTA / 100) +
      scores.rsiMomentum * (this.WEIGHTS.RSI_MOMENTUM / 100) +
      scores.volumeSpike * (this.WEIGHTS.VOLUME_SPIKE / 100) +
      scores.btcContext * (this.WEIGHTS.BTC_CONTEXT / 100);

    const roundedScore = Math.round(totalScore * 100) / 100;

    // Only log DEBUG for scores above threshold or very close (to reduce verbosity)
    if (roundedScore >= this.minScoreThreshold - 5) {
      this.logger.debug(
        `Score breakdown for ${context.fundingRate.toFixed(4)}% funding: ${JSON.stringify(scores)} = ${roundedScore}`,
      );
    }

    return roundedScore;
  }

  /**
   * Score funding rate extremity (0-100)
   * Higher score for more extreme funding rates
   */
  private scoreFundingExtremity(fundingRate: number): number {
    const absFunding = Math.abs(fundingRate);

    // Extreme levels
    if (absFunding >= 0.04) return 100; // +0.04% or -0.04%
    if (absFunding >= 0.03) return 90;
    if (absFunding >= 0.02) return 75;
    if (absFunding >= 0.015) return 60;
    if (absFunding >= 0.01) return 45;
    if (absFunding >= 0.005) return 30;
    if (absFunding >= 0.002) return 15;

    return 0;
  }

  /**
   * Score funding delta/velocity (0-100)
   * Higher score for accelerating funding rates
   */
  private scoreFundingDelta(
    fundingRate: number,
    fundingDelta: number,
  ): number {
    if (!fundingDelta || fundingDelta === 0) return 50; // Neutral

    const absDelta = Math.abs(fundingDelta);

    // Strong acceleration
    if (absDelta >= 0.01) return 100;
    if (absDelta >= 0.005) return 85;
    if (absDelta >= 0.002) return 70;
    if (absDelta >= 0.001) return 55;

    // Check if delta is in same direction as funding (reinforcing)
    const isReinforcing =
      (fundingRate > 0 && fundingDelta > 0) ||
      (fundingRate < 0 && fundingDelta < 0);

    if (isReinforcing) {
      return Math.min(60 + absDelta * 10000, 100);
    }

    return 40; // Contradictory delta
  }

  /**
   * Score RSI and momentum alignment (0-100)
   */
  private scoreRSIMomentum(rsi: number | null, momentum: number | null): number {
    if (!rsi || !momentum) return 50; // Neutral if missing

    const absMomentum = Math.abs(momentum);

    // Extreme RSI with strong momentum = high score
    if (rsi >= 70 && momentum > 0) return 100; // Overbought exhaustion
    if (rsi <= 30 && momentum < 0) return 100; // Oversold exhaustion

    // Strong momentum with healthy RSI = continuation
    if (absMomentum > 2.0 && rsi >= 40 && rsi <= 60) return 85;

    // Moderate alignment
    if (rsi >= 60 && momentum > 1.0) return 70;
    if (rsi <= 40 && momentum < -1.0) return 70;

    // Weak alignment
    if (absMomentum > 0.5) return 50;

    return 30; // No clear signal
  }

  /**
   * Score volume spike (0-100)
   */
  private scoreVolumeSpike(volume24h: number | null): number {
    if (!volume24h) return 50; // Neutral if missing

    // Normalize volume (this is simplified - in production, use historical average)
    // For now, assume higher volume = better confirmation
    // In production, compare against 30-day average

    // This is a placeholder - should be improved with historical data
    return 60; // Default moderate score
  }

  /**
   * Score BTC market context (0-100)
   */
  private scoreBTCContext(
    btcContext: { price: number; fundingRate: number } | undefined,
  ): number {
    if (!btcContext) return 50; // Neutral if BTC context disabled

    // If BTC funding aligns with signal, boost score
    // If BTC funding contradicts, reduce score
    const btcFunding = btcContext.fundingRate;

    // BTC extreme funding adds context
    if (Math.abs(btcFunding) >= 0.02) return 80;
    if (Math.abs(btcFunding) >= 0.01) return 65;
    if (Math.abs(btcFunding) >= 0.005) return 55;

    return 50; // Neutral BTC context
  }

  /**
   * Check if score meets threshold
   */
  meetsThreshold(score: number): boolean {
    return score >= this.minScoreThreshold;
  }

  /**
   * Get minimum score threshold
   */
  getMinThreshold(): number {
    return this.minScoreThreshold;
  }
}