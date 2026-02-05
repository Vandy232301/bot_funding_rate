import { Module } from '@nestjs/common';
import { IndicatorService } from './indicator.service';

@Module({
  providers: [IndicatorService],
  exports: [IndicatorService],
})
export class IndicatorsModule {}