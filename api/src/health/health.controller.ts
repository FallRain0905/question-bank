import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { getHealthResponse, getReadinessResponse } from './health.responses';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Check API liveness' })
  @ApiResponse({ status: 200, description: 'The API process is alive.' })
  getHealth() {
    return getHealthResponse();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check API readiness' })
  @ApiResponse({ status: 200, description: 'The API is ready for traffic.' })
  async getReadiness() {
    return getReadinessResponse(await this.database.check());
  }
}
