import { Module, Global, OnModuleInit } from '@nestjs/common';
import { StateMachineService } from './state-machine/state-machine.service';
import { AuthUserService } from './auth-user.service';
import { PawnshopGuard } from './guards/pawnshop.guard';
import { StorageService } from './storage/storage.service';
import { PermissionsModule } from './permissions/permissions.module';
import {
  TICKET_LIFECYCLE,
  LOAN_APPLICATION_LIFECYCLE,
  COMPLIANCE_LIFECYCLE,
} from './state-machine/pawn-lifecycle';

@Global()
@Module({
  imports: [PermissionsModule],
  providers: [
    StateMachineService,
    AuthUserService,
    PawnshopGuard,
    StorageService,
  ],
  exports: [
    StateMachineService,
    AuthUserService,
    PawnshopGuard,
    StorageService,
  ],
})
export class CommonModule implements OnModuleInit {
  constructor(private readonly stateMachine: StateMachineService) {}

  onModuleInit() {
    this.stateMachine.registerDomain('TICKET_LIFECYCLE', TICKET_LIFECYCLE);
    this.stateMachine.registerDomain('LOAN_APPLICATION_LIFECYCLE', LOAN_APPLICATION_LIFECYCLE);
    this.stateMachine.registerDomain('COMPLIANCE_LIFECYCLE', COMPLIANCE_LIFECYCLE);
  }
}
