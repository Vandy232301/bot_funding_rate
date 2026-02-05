import { SignalType, SignalBias } from '../../database/entities/signal.entity';

export interface Signal {
  symbol: string;
  signalType: SignalType;
  bias: SignalBias;
  fundingRate: number;
  fundingDelta: number;
  rsi: number;
  rsi15m?: number;
  rsi5m?: number;
  rsi1m?: number;
  score: number;
  price: number;
  timeframe: string;
  context: string;
  momentum: 'Exhaustion' | 'Expansion';
  fundingBias: 'LONG Overcrowded' | 'SHORT Overcrowded';
  movement?: {
    up: number; // percentage up
    down: number; // percentage down
  };
}

export interface SignalContext {
  fundingRate: number;
  fundingDelta: number;
  rsi: number;
  price: number;
  volume24h: number;
  momentum: number;
  btcContext?: {
    price: number;
    fundingRate: number;
  };
}