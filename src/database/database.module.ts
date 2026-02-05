import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Signal } from './entities/signal.entity';
import { FundingSnapshot } from './entities/funding-snapshot.entity';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file before checking ENABLE_DATABASE
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * DatabaseModule - Optional database module
 * If ENABLE_DATABASE=false, returns an empty module (no TypeORM connection)
 */
@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    // Check if database is enabled via environment variable
    // Read directly from process.env (ConfigModule loads .env, but this runs during module registration)
    const enableDatabase = process.env.ENABLE_DATABASE !== 'false' && process.env.ENABLE_DATABASE !== '0';
    
    if (!enableDatabase) {
      // Return empty module - no database connection
      return {
        module: DatabaseModule,
        imports: [],
        exports: [],
      };
    }

    // Database is enabled - configure TypeORM
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: (configService: ConfigService) => {
            const sslEnabled = configService.get('POSTGRES_SSL', 'false') === 'true';

            const config: any = {
              type: 'postgres',
              host: configService.get('POSTGRES_HOST', 'localhost'),
              port: configService.get('POSTGRES_PORT', 5432),
              username: configService.get('POSTGRES_USER', 'postgres'),
              password: configService.get('POSTGRES_PASSWORD', 'postgres'),
              database: configService.get('POSTGRES_DB', 'dynasty_bot'),
              entities: [Signal, FundingSnapshot],
              synchronize: configService.get('NODE_ENV') !== 'production',
              logging: configService.get('NODE_ENV') === 'development',
              retryAttempts: 1,
              retryDelay: 1000,
            };

            // SSL pentru Digital Ocean Managed Databases
            if (sslEnabled) {
              config.ssl = {
                rejectUnauthorized: false,
              };
            }

            return config;
          },
          inject: [ConfigService],
        }),
        TypeOrmModule.forFeature([Signal, FundingSnapshot]),
      ],
      exports: [TypeOrmModule],
    };
  }
}