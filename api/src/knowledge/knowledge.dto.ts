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

export class CreateCollectionDto {
  @IsString({ message: '名称必须是文本' })
  @MinLength(1, { message: '名称不能为空' })
  @MaxLength(80, { message: '名称请控制在 80 字以内' })
  name!: string;

  @IsOptional()
  @IsString({ message: '描述必须是文本' })
  @MaxLength(500, { message: '描述请控制在 500 字以内' })
  description?: string;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString({ message: '名称必须是文本' })
  @MinLength(1, { message: '名称不能为空' })
  @MaxLength(80, { message: '名称请控制在 80 字以内' })
  name?: string;

  @IsOptional()
  @IsString({ message: '描述必须是文本' })
  @MaxLength(500, { message: '描述请控制在 500 字以内' })
  description?: string;
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

  @IsOptional()
  @IsUUID('4', { message: 'collectionId 必须是 UUID' })
  collectionId?: string;
}
