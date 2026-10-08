import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { LlmService } from './llm.service';
import { MineruService } from './mineru.service';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, EmbeddingService, LlmService, MineruService],
  exports: [KnowledgeService, EmbeddingService, LlmService, MineruService],
})
export class KnowledgeModule {}
