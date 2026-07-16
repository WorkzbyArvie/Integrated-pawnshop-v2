import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsNotEmpty()
  @IsString()
  pawnshopId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(300)
  location: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  managerName?: string;
}
