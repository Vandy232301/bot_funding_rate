import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SignalType {
  REVERSAL = 'REVERSAL',
  TREND = 'TREND',
  DIVERGENCE = 'DIVERGENCE',
}

export enum SignalBias {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

@Entity('signals')
@Index(['symbol', 'createdAt'])
@Index(['score', 'createdAt'])
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'enum', enum: SignalType })
  signalType: SignalType;

  @Column({ type: 'enum', enum: SignalBias })
  bias: SignalBias;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  fundingRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  fundingDelta: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  rsi: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  score: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  price: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  timeframe: string;

  @Column({ type: 'text', nullable: true })
  context: string;

  @Column({ type: 'boolean', default: false })
  sentToDiscord: boolean;

  @CreateDateColumn()
  createdAt: Date;
}