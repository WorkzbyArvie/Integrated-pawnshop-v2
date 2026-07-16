import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';

export class RegisterPushTokenDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  deviceToken: string;

  @IsNotEmpty()
  @IsEnum(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  @IsOptional()
  @IsString()
  deviceName?: string;
}
