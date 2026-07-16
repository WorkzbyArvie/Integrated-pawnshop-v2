import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ConfigureOnboardingDto {
  @IsNotEmpty()
  @IsString()
  pawnshopId: string;

  @IsArray()
  @IsString({ each: true })
  selectedModules: string[];

  @IsInt()
  @Min(1)
  @Max(10000)
  staffCount: number;

  @IsOptional()
  roleAssignments?: Record<string, number>;
}
