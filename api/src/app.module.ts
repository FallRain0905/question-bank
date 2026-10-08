import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [DatabaseModule, StorageModule, HealthModule, KnowledgeModule],
})
export class AppModule {}
