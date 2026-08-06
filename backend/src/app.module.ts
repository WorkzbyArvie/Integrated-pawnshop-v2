import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { PawnshopGuard } from './common/guards/pawnshop.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { ComplianceGuard } from './common/guards/compliance.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuctionModule } from './auction/auction.module';
import { QueueModule } from './queue/queue.module';
import { NotificationModule } from './notification/notification.module';
import { ComplianceModule } from './compliance/compliance.module';
import { FinanceModule } from './finance/finance.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ApprovalModule } from './approval/approval.module';
import { PayrollModule } from './payroll/payroll.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { LoanModule } from './loan/loan.module';
import { ProfileModule } from './profile/profile.module';
import { SecurityModule } from './security/security.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TenantGovernanceModule } from './tenant-governance/tenant-governance.module';
import { BrandingModule } from './branding/branding.module';
import { ContractModule } from './contract/contract.module';
import { ReceiptModule } from './receipt/receipt.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    CommonModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AnalyticsModule,
    AuctionModule,
    QueueModule,
    NotificationModule,
    ComplianceModule,
    FinanceModule,
    AttendanceModule,
    ApprovalModule,
    PayrollModule,
    SubscriptionModule,
    LoanModule,
    ProfileModule,
    SecurityModule,
    PaymentMethodsModule,
    TenantGovernanceModule,
    BrandingModule,
    ContractModule,
    ReceiptModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: PawnshopGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ComplianceGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
