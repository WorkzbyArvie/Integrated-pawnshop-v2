import { IsString } from 'class-validator';

export class SignComplianceContractDto {
  @IsString()
  signedName: string;
}
