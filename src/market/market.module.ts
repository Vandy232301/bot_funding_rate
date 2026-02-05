import { Module } from '@nestjs/common';
import { BybitModule } from '../bybit/bybit.module';
import { MarketDataService } from './market-data.service';
import { FundingStreamService } from './funding-stream.service';

@Module({
  imports: [BybitModule],
  providers: [MarketDataService, FundingStreamService],
  exports: [MarketDataService, FundingStreamService],
})
export class MarketModule {}