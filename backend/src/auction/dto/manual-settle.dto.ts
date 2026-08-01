import { IsNumber, IsString, Min } from 'class-validator';

export class ManualSettleDto {
  @IsNumber()
  listingId: number;

  @IsString()
  winnerId: string;

  @IsString()
  winnerFullName: string;

  @IsString()
  winnerPhone: string;

  @IsNumber()
  @Min(0)
  winningBid: number;
}
