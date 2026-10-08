import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [DatabaseModule, HealthModule, KnowledgeModule],
})
export class AppModule {}
