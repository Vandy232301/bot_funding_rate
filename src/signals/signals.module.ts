import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DiscordModule } from '../discord/discord.module';
import { DatabaseModule } from '../database/database.module';
import { SignalValidatorService } from './signal-validator.service';
import { SignalService } from './signal.service';

@Module({
  imports: [
    MarketModule,
    IndicatorsModule, // Provides IndicatorService
    ScoringModule,
    DiscordModule,
    DatabaseModule.forRoot(),
  ],
  providers: [SignalValidatorService, SignalService],
  exports: [SignalValidatorService, SignalService],
})
export class SignalsModule {}