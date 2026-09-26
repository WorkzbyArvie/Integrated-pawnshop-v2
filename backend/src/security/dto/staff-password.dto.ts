import { IsNotEmpty, IsString } from 'class-validator';

export class StaffPasswordDto {
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}
