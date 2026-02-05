import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  logger.log('🚀 Starting DYNASTY Funding Rate Bot...');
  logger.log('📦 Loading application modules...');
  
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });
    
    // Enable graceful shutdown
    app.enableShutdownHooks();
    
    logger.log('🐺 DYNASTY Funding Rate Bot started successfully!');
    logger.log('⚡ Monitoring Bybit USDT perpetual pairs...');
    logger.log('📊 Waiting for market data...');
    logger.log('💬 Discord alerts are ready');
    
    // Keep the application running
    process.on('SIGINT', async () => {
      logger.log('🛑 Shutting down gracefully...');
      await app.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.log('🛑 Shutting down gracefully...');
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});