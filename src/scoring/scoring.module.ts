import { Module } from '@nestjs/common';
import { ScoringEngineService } from './scoring-engine.service';

@Module({
  providers: [ScoringEngineService],
  exports: [ScoringEngineService],
})
export class ScoringModule {}