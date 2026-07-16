import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { AddPaymentMethodDto } from './dto/add-payment-method.dto';
import { AuthUserService } from '../common/auth-user.service';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly authUserService: AuthUserService,
  ) {}

  @Get()
  async listMyPaymentMethods(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.paymentMethodsService.listMyPaymentMethods(userId);
  }

  @Post()
  async addMyPaymentMethod(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: AddPaymentMethodDto,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.paymentMethodsService.addMyPaymentMethod(userId, body);
  }

  @Patch(':id/default')
  async setDefaultPaymentMethod(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.paymentMethodsService.setDefaultPaymentMethod(userId, id);
  }

  @Delete(':id')
  async removePaymentMethod(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.paymentMethodsService.removeMyPaymentMethod(userId, id);
  }
}
