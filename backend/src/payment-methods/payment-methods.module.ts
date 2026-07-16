import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { AuthUserService } from '../common/auth-user.service';

@Module({
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService, AuthUserService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
