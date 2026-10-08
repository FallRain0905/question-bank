import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReindexDto {
  /** Re-run PDF conversion from the stored original file instead of re-chunking saved markdown. */
  @IsOptional()
  @IsBoolean({ message: 'fromSource 必须是布尔值' })
  fromSource?: boolean;
}

export class AskDto {
  @IsString({ message: '问题必须是文本' })
  @MinLength(1, { message: '问题不能为空' })
  @MaxLength(2000, { message: '问题过长，请控制在 2000 字以内' })
  question!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'topK 必须是整数' })
  @Min(1, { message: 'topK 最小为 1' })
  @Max(20, { message: 'topK 最大为 20' })
  topK?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'documentIds 必须是 UUID 列表' })
  documentIds?: string[];
}
