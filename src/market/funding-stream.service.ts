import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { FundingData } from '../common/interfaces/market-data.interface';
import { Subject, interval } from 'rxjs';
import { map, filter } from 'rxjs/operators';

/**
 * FundingStreamService - Monitors funding rate changes and calculates deltas
 * Tracks funding rate velocity and acceleration
 */
@Injectable()
export class FundingStreamService implements OnModuleInit {
  private readonly logger = new Logger(FundingStreamService.name);
  
  // Track funding rate history for delta calculation
  private fundingHistory = new Map<string, FundingData[]>();
  
  // Observables
  public fundingUpdate$ = new Subject<{
    symbol: string;
    fundingRate: number;
    fundingDelta: number;
    fundingVelocity: number; // Rate of change
  }>();

  constructor(private marketDataService: MarketDataService) {}

  async onModuleInit() {
    // Subscribe to funding rate updates
    this.marketDataService.fundingData$.subscribe((data) => {
      this.processFundingUpdate(data);
    });

    // Periodic cleanup of old history (keep last 10 snapshots per symbol)
    interval(60000).subscribe(() => {
      this.cleanupHistory();
    });
  }

  /**
   * Process funding rate update and calculate delta
   */
  private processFundingUpdate(data: FundingData): void {
    const history = this.fundingHistory.get(data.symbol) || [];
    
    // Add to history
    history.push(data);
    
    // Keep only last 10 snapshots
    if (history.length > 10) {
      history.shift();
    }
    
    this.fundingHistory.set(data.symbol, history);

    // Calculate delta (change from previous)
    let fundingDelta = 0;
    let fundingVelocity = 0;

    if (history.length >= 2) {
      const previous = history[history.length - 2];
      fundingDelta = data.fundingRate - previous.fundingRate;
      
      // Calculate velocity (rate of change over time)
      const timeDelta = (data.fundingRateTimestamp - previous.fundingRateTimestamp) / 1000; // seconds
      if (timeDelta > 0) {
        fundingVelocity = fundingDelta / timeDelta;
      }
    }

    // Emit update with delta
    this.fundingUpdate$.next({
      symbol: data.symbol,
      fundingRate: data.fundingRate,
      fundingDelta,
      fundingVelocity,
    });
  }

  /**
   * Get funding delta for a symbol
   */
  getFundingDelta(symbol: string): number {
    const history = this.fundingHistory.get(symbol) || [];
    if (history.length < 2) return 0;
    
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    
    return current.fundingRate - previous.fundingRate;
  }

  /**
   * Get funding velocity for a symbol
   */
  getFundingVelocity(symbol: string): number {
    const history = this.fundingHistory.get(symbol) || [];
    if (history.length < 2) return 0;
    
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    const timeDelta = (current.fundingRateTimestamp - previous.fundingRateTimestamp) / 1000;
    
    if (timeDelta <= 0) return 0;
    
    return (current.fundingRate - previous.fundingRate) / timeDelta;
  }

  /**
   * Get current funding rate for a symbol
   */
  getCurrentFundingRate(symbol: string): number | null {
    const history = this.fundingHistory.get(symbol) || [];
    if (history.length === 0) return null;
    
    return history[history.length - 1].fundingRate;
  }

  /**
   * Cleanup old history entries
   */
  private cleanupHistory(): void {
    for (const [symbol, history] of this.fundingHistory.entries()) {
      if (history.length > 10) {
        this.fundingHistory.set(symbol, history.slice(-10));
      }
    }
  }
}