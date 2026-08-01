import { SetMetadata } from '@nestjs/common';

export const COMPLIANCE_KEY = 'required_compliance_score';
export const RequiresCompliance = (minScore: number) => SetMetadata(COMPLIANCE_KEY, minScore);
