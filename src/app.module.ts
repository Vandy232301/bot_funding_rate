import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

import { ConfigModule as AppConfigModule } from './config/config.module';
import { BybitModule } from './bybit/bybit.module';
import { MarketModule } from './market/market.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { ScoringModule } from './scoring/scoring.module';
import { SignalsModule } from './signals/signals.module';
import { DiscordModule } from './discord/discord.module';
import { DatabaseModule } from './database/database.module';

// Check if .env file is readable before trying to load it
const envFilePath = path.join(process.cwd(), '.env');
const canReadEnvFile = (() => {
  try {
    fs.accessSync(envFilePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
})();

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      // Only try to load .env if we can read it (avoid EPERM errors in sandbox)
      envFilePath: canReadEnvFile ? '.env' : undefined,
      ignoreEnvFile: !canReadEnvFile, // Ignore .env if we can't read it
      expandVariables: true,
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