import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsObject,
} from 'class-validator';
import { NotificationChannel, NotificationType } from '@prisma/client';

export class SendNotificationDto {
  @IsNotEmpty()
  @IsString()
  recipientId: string;

  @IsNotEmpty()
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsNotEmpty()
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  scheduledFor?: Date;

  @IsOptional()
  @IsDateString()
  expiresAt?: Date;
}
