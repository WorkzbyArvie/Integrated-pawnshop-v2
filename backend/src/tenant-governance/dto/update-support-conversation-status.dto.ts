import { IsIn, IsString } from 'class-validator';

export class UpdateSupportConversationStatusDto {
  @IsString()
  @IsIn(['OPEN', 'HANDLING', 'FIXING', 'DONE', 'CLOSED'])
  status: 'OPEN' | 'HANDLING' | 'FIXING' | 'DONE' | 'CLOSED';
}
