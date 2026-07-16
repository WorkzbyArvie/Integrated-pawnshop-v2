import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class PlaceBidDto {
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount!: number;
}
