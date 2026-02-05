export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  timestamp: number;
}

export interface FundingData {
  symbol: string;
  fundingRate: number;
  fundingRateTimestamp: number;
  nextFundingTime: number;
}

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  volume?: number;
}

export interface IndicatorData {
  rsi?: number;
  momentum?: number;
  volumeSpike?: number;
}

export interface MarketContext {
  btcPrice?: number;
  btcFundingRate?: number;
  marketTrend?: 'bullish' | 'bearish' | 'neutral';
}