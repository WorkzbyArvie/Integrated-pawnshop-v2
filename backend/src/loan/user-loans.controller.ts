import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthUserService } from '../common/auth-user.service';
import { UserLoansService } from './user-loans.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('loans')
export class UserLoansController {
  constructor(
    private readonly authUserService: AuthUserService,
    private readonly userLoansService: UserLoansService,
  ) {}

  @Get('my-items')
  async getMyLoanItems(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.userLoansService.getMyLoanItems(userId);
  }

  @Get('my-history')
  async getMyPaidItems(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.userLoansService.getMyPaidItems(userId);
  }

  @Post(':ticketId/pay-link')
  async createPayLink(
    @Headers('authorization') authHeader: string | undefined,
    @Param('ticketId') ticketId: string,
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.userLoansService.createPayLinkForTicket(
      userId,
      Number(ticketId),
    );
  }

  @Post(':ticketId/confirm-payment')
  async confirmPayment(
    @Headers('authorization') authHeader: string | undefined,
    @Param('ticketId') ticketId: string,
    @Body() body: { paymentLinkId?: string; checkoutReferenceId?: string },
  ) {
    const userId =
      await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const paymentLinkId = String(
      body?.paymentLinkId || body?.checkoutReferenceId || '',
    ).trim();
    if (!paymentLinkId) {
      throw new Error('paymentLinkId or checkoutReferenceId is required');
    }

    return this.userLoansService.confirmPaymentLinkAndSync(
      userId,
      Number(ticketId),
      paymentLinkId,
    );
  }

  @Public()
  @Post('xendit/webhook')
  async handleXenditWebhook(@Body() body: any) {
    return this.userLoansService.handleProviderPawnWebhook(body);
  }

  @Public()
  @Post('paymongo/webhook')
  async handlePaymongoWebhook(@Body() body: any) {
    return this.userLoansService.handleProviderPawnWebhook(body);
  }
}
