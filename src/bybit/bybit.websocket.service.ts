import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import { FundingData, PriceData } from '../common/interfaces/market-data.interface';
import * as WebSocket from 'ws';

@Injectable()
export class BybitWebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BybitWebSocketService.name);
  private readonly testnet: boolean;
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private subscribedSymbols = new Set<string>();

  // Observables for real-time data
  public fundingRate$ = new Subject<FundingData>();
  public priceUpdate$ = new Subject<PriceData>();

  constructor(private configService: ConfigService) {
    this.testnet = this.configService.get<boolean>('BYBIT_TESTNET', false);
    this.wsUrl = this.testnet
      ? 'wss://stream-testnet.bybit.com/v5/public/linear'
      : 'wss://stream.bybit.com/v5/public/linear';
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.disconnect();
  }

  /**
   * Connect to Bybit WebSocket
   */
  private async connect(): Promise<void> {
    try {
      this.logger.log(`Connecting to Bybit WebSocket: ${this.wsUrl}`);
      this.ws = new (WebSocket as any)(this.wsUrl);

      this.ws.on('open', () => {
        this.logger.log('✅ Connected to Bybit WebSocket');
        this.isConnected = true;
        this.startHeartbeat();
        this.resubscribeAll();
      });

      this.ws.on('message', (data: any) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error: any) => {
        this.logger.error('WebSocket error', error);
      });

      this.ws.on('close', () => {
        this.logger.warn('WebSocket closed, reconnecting...');
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      });
    } catch (error) {
      this.logger.error('Failed to connect to WebSocket', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping();
      }
    }, 20000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: string): void {
    try {
      const data = JSON.parse(message);

      // Handle subscription confirmation
      if (data.op === 'subscribe' && data.success) {
        this.logger.debug(`Subscribed to: ${data.ret_msg}`);
        return;
      }

      // Handle funding rate updates
      if (data.topic?.includes('funding')) {
        const topic = data.topic as string;
        const symbol = topic.split('.')[1];
        const fundingRate = parseFloat(data.data[0].fundingRate) * 100;

        this.fundingRate$.next({
          symbol,
          fundingRate,
          fundingRateTimestamp: parseInt(data.data[0].nextFundingTime),
          nextFundingTime: parseInt(data.data[0].nextFundingTime),
        });
      }

      // Handle ticker/price updates
      if (data.topic?.includes('tickers')) {
        const topic = data.topic as string;
        const symbol = topic.split('.')[1];
        const price = parseFloat(data.data.lastPrice);

        this.priceUpdate$.next({
          symbol,
          price,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      this.logger.error('Error handling WebSocket message', error);
    }
  }

  /**
   * Subscribe to funding rate updates for a symbol
   */
  subscribeFundingRate(symbol: string): void {
    if (!this.isConnected || !this.ws) {
      this.logger.warn('WebSocket not connected, subscription queued');
      this.subscribedSymbols.add(symbol);
      return;
    }

    const topic = `funding.${symbol}`;
    const message = {
      op: 'subscribe',
      args: [topic],
    };

    this.ws.send(JSON.stringify(message));
    this.subscribedSymbols.add(symbol);
  }

  /**
   * Subscribe to ticker updates for a symbol
   */
  subscribeTicker(symbol: string): void {
    if (!this.isConnected || !this.ws) {
      this.logger.warn('WebSocket not connected, subscription queued');
      this.subscribedSymbols.add(symbol);
      return;
    }

    const topic = `tickers.${symbol}`;
    const message = {
      op: 'subscribe',
      args: [topic],
    };

    this.ws.send(JSON.stringify(message));
    this.subscribedSymbols.add(symbol);
  }

  /**
   * Subscribe to multiple symbols
   */
  subscribeSymbols(symbols: string[]): void {
    symbols.forEach((symbol) => {
      this.subscribeFundingRate(symbol);
      this.subscribeTicker(symbol);
    });
  }

  /**
   * Resubscribe to all previously subscribed symbols
   */
  private resubscribeAll(): void {
    if (this.subscribedSymbols.size > 0) {
      this.logger.log(`Resubscribing to ${this.subscribedSymbols.size} symbols`);
      this.subscribeSymbols(Array.from(this.subscribedSymbols));
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isWsConnected(): boolean {
    return this.isConnected;
  }
}