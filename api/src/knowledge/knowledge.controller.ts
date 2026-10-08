import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AskDto, ReindexDto } from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@ApiBearerAuth('api-token')
@UseGuards(AccessTokenGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('documents')
  @ApiOperation({ summary: 'Upload a PDF/Markdown/text document and start indexing' })
  async uploadDocument(@Req() request: FastifyRequest) {
    const file = await request.file();
    if (!file) {
      throw new BadRequestException('缺少上传文件（multipart 字段名 file）');
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new PayloadTooLargeException('文件超过大小限制');
      }
      throw error;
    }

    if (file.file.truncated) {
      throw new PayloadTooLargeException('文件超过大小限制');
    }

    return this.knowledge.createDocument({
      filename: file.filename,
      mimetype: file.mimetype,
      buffer,
    });
  }

  @Get('documents')
  @ApiOperation({ summary: 'List knowledge base documents' })
  listDocuments() {
    return this.knowledge.listDocuments();
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get one document including converted markdown' })
  getDocument(@Param('id') id: string) {
    return this.knowledge.getDocument(id);
  }

  @Get('documents/:id/logs')
  @ApiOperation({ summary: 'Indexing log lines for a document' })
  getDocumentLogs(@Param('id') id: string) {
    return this.knowledge.getDocumentLogs(id);
  }

  @Delete('documents/:id')
  @ApiOperation({ summary: 'Delete a document and its chunks' })
  deleteDocument(@Param('id') id: string) {
    return this.knowledge.deleteDocument(id);
  }

  @Post('documents/:id/reindex')
  @ApiOperation({ summary: 'Re-chunk and re-embed a document, optionally re-running PDF conversion' })
  reindexDocument(@Param('id') id: string, @Body() body: ReindexDto) {
    return this.knowledge.reindex(id, { fromSource: body?.fromSource });
  }

  @Post('ask')
  @ApiOperation({ summary: 'Answer a question from indexed documents with citations' })
  ask(@Body() body: AskDto) {
    return this.knowledge.ask(body);
  }
}
