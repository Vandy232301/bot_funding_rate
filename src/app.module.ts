import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule as AppConfigModule } from './config/config.module';
import { BybitModule } from './bybit/bybit.module';
import { MarketModule } from './market/market.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { ScoringModule } from './scoring/scoring.module';
import { SignalsModule } from './signals/signals.module';
import { DiscordModule } from './discord/discord.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    
    // Application Modules
    AppConfigModule,
    DatabaseModule.forRoot(),
    BybitModule,
    MarketModule,
    IndicatorsModule,
    ScoringModule,
    SignalsModule,
    DiscordModule,
  ],
})
export class AppModule {}