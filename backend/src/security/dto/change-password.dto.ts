import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'Password must include at least one uppercase letter',
  })
  @Matches(/[a-z]/, {
    message: 'Password must include at least one lowercase letter',
  })
  @Matches(/[0-9]/, { message: 'Password must include at least one number' })
  newPassword: string;
}
