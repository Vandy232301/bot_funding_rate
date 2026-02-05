import { Module } from '@nestjs/common';
import { BybitService } from './bybit.service';
import { BybitWebSocketService } from './bybit.websocket.service';

@Module({
  providers: [BybitService, BybitWebSocketService],
  exports: [BybitService, BybitWebSocketService],
})
export class BybitModule {}