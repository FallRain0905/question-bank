import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { LlmService } from './llm.service';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, EmbeddingService, LlmService],
  exports: [KnowledgeService, EmbeddingService, LlmService],
})
export class KnowledgeModule {}
