import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUserService } from '../common/auth-user.service';
import { TenantGovernanceService } from './tenant-governance.service';
import { RequiresPermission } from '../common/decorators/requires-permission.decorator';
import { PERMISSIONS } from '../common/permissions/permissions.const';
import { RequestSupportAccessDto } from './dto/request-support-access.dto';
import { ApproveSupportAccessDto } from './dto/approve-support-access.dto';
import { ConfigureOnboardingDto } from './dto/configure-onboarding.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { CreateClientRegistrationDto } from './dto/create-client-registration.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateSupportConversationDto } from './dto/create-support-conversation.dto';
import { PostSupportMessageDto } from './dto/post-support-message.dto';
import { ReviewClientRegistrationDto } from './dto/review-client-registration.dto';
import { UpdateSupportConversationStatusDto } from './dto/update-support-conversation-status.dto';
import { PostClientRegistrationMessageDto } from './dto/post-client-registration-message.dto';
import { CancelClientRegistrationDto } from './dto/cancel-client-registration.dto';
import { CreatePawnshopDirectDto } from './dto/create-pawnshop-direct.dto';
import { InviteOwnerDto } from './dto/invite-owner.dto';
import { ExtendTrialDto, UpgradeTierDto, AdjustSubscriptionStatusDto } from './dto/manage-subscription.dto';

@Controller('tenant-governance')
export class TenantGovernanceController {
  constructor(
    private readonly tenantGovernanceService: TenantGovernanceService,
    private readonly authUserService: AuthUserService,
  ) {}

  @Get('pawnshops/metadata')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getPawnshopMetadata(@Headers('authorization') authHeader?: string) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.getPawnshopMetadata(userId);
  }

  @Post('support-access/request')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async requestSupportAccess(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: RequestSupportAccessDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.requestSupportAccess(userId, dto);
  }

  @Post('support-access/:requestId/approve')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async approveSupportAccess(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveSupportAccessDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.approveSupportAccess(userId, requestId, dto);
  }

  @Post('support-access/:grantId/revoke')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async revokeSupportAccess(
    @Headers('authorization') authHeader: string | undefined,
    @Param('grantId') grantId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.revokeSupportAccess(userId, grantId);
  }

  @Get('support-access/audit')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getSupportAccessAudit(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.getSupportAccessAudit(userId, pawnshopId);
  }

  @Get('audit/history')
  @RequiresPermission(PERMISSIONS['tenant.view_audit'])
  async getTenantAuditHistory(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.tenantGovernanceService.getTenantAuditHistory(userId, pawnshopId, parsedLimit);
  }

  @Get('support-access/status')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getSupportAccessStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.getSupportAccessStatus(userId, pawnshopId);
  }

  @Get('support-access/requests')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async listSupportAccessRequests(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
    @Query('status') status?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listSupportAccessRequests(
      userId,
      pawnshopId,
      status,
    );
  }

  @Post('onboarding/configure')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async configureOnboarding(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: ConfigureOnboardingDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.configureOnboarding(userId, dto);
  }

  @Patch('branding')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async updateBranding(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: UpdateBrandingDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.updateBranding(userId, dto);
  }

  @Get('branding')
  async getBranding(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.getEffectiveBranding(userId, pawnshopId);
  }

  @Post('public/client-registration')
  async createClientRegistration(@Body() dto: CreateClientRegistrationDto) {
    return this.tenantGovernanceService.createClientRegistration(dto);
  }

  @Post('client-registrations/me')
  async createMyClientRegistration(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateClientRegistrationDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.createClientRegistrationForOwner(userId, dto);
  }

  @Get('client-registrations/me')
  async listMyClientRegistrations(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listMyClientRegistrationRequests(userId);
  }

  @Get('client-registrations')
  async listClientRegistrations(
    @Headers('authorization') authHeader: string | undefined,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listClientRegistrationRequests(
      userId,
      status,
      branchId,
    );
  }

  @Post('client-registrations/:requestId/review')
  @RequiresPermission(PERMISSIONS['onboarding.approve'])
  async reviewClientRegistration(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewClientRegistrationDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.reviewClientRegistrationRequest(
      userId,
      requestId,
      dto,
    );
  }

  @Post('client-registrations/:requestId/cancel')
  async cancelMyClientRegistration(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Body() dto: CancelClientRegistrationDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.cancelMyClientRegistrationRequest(
      userId,
      requestId,
      dto,
    );
  }

  @Get('client-registrations/:requestId/messages')
  async listClientRegistrationMessages(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listClientRegistrationMessages(userId, requestId);
  }

  @Post('client-registrations/:requestId/messages')
  async postClientRegistrationMessage(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Body() dto: PostClientRegistrationMessageDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.postClientRegistrationMessage(
      userId,
      requestId,
      dto,
    );
  }

  @Post('client-registrations/:requestId/documents')
  async uploadRegistrationDocument(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Body() dto: { documentType: string; fileName: string; fileUrl: string; fileSize?: number },
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.uploadRegistrationDocument(userId, requestId, dto);
  }

  @Get('client-registrations/:requestId/documents')
  async listRegistrationDocuments(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listRegistrationDocuments(userId, requestId);
  }

  @Get('client-registrations/:requestId/documents/admin')
  @RequiresPermission(PERMISSIONS['onboarding.review_documents'])
  async adminListRegistrationDocuments(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.adminListRegistrationDocuments(userId, requestId);
  }

  @Post('client-registrations/:requestId/documents/:documentId/review')
  @RequiresPermission(PERMISSIONS['onboarding.approve'])
  async reviewRegistrationDocument(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Param('documentId') documentId: string,
    @Body() dto: { decision: 'APPROVED' | 'REJECTED'; rejectionReason?: string },
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.reviewRegistrationDocument(userId, requestId, documentId, dto);
  }

  @Post('client-registrations/:requestId/documents/:documentId/view')
  @RequiresPermission(PERMISSIONS['onboarding.review_documents'])
  async markRegistrationDocumentViewed(
    @Headers('authorization') authHeader: string | undefined,
    @Param('requestId') requestId: string,
    @Param('documentId') documentId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.markRegistrationDocumentViewed(userId, requestId, documentId);
  }

  @Get('branches')
  @RequiresPermission(PERMISSIONS['tenant.manage_branches'])
  async listBranches(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listBranches(userId, pawnshopId);
  }

  @Post('branches')
  @RequiresPermission(PERMISSIONS['tenant.manage_branches'])
  async createBranch(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateBranchDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.createBranch(userId, dto);
  }

  @Patch('branches/:branchId')
  @RequiresPermission(PERMISSIONS['tenant.manage_branches'])
  async updateBranch(
    @Headers('authorization') authHeader: string | undefined,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.updateBranch(userId, branchId, dto);
  }

  @Get('support-chat/conversations')
  async listSupportConversations(
    @Headers('authorization') authHeader: string | undefined,
    @Query('pawnshopId') pawnshopId?: string,
    @Query('pawnshopName') pawnshopName?: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listSupportConversations(
      userId,
      pawnshopId,
      pawnshopName,
    );
  }

  @Post('support-chat/conversations')
  async createSupportConversation(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreateSupportConversationDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.createSupportConversation(userId, dto);
  }

  @Get('support-chat/conversations/:conversationId/messages')
  async listSupportMessages(
    @Headers('authorization') authHeader: string | undefined,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.listSupportMessages(userId, conversationId);
  }

  @Post('support-chat/conversations/:conversationId/messages')
  async postSupportMessage(
    @Headers('authorization') authHeader: string | undefined,
    @Param('conversationId') conversationId: string,
    @Body() dto: PostSupportMessageDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.postSupportMessage(userId, conversationId, dto);
  }

  @Patch('support-chat/conversations/:conversationId/status')
  async updateSupportConversationStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateSupportConversationStatusDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.updateSupportConversationStatus(
      userId,
      conversationId,
      dto,
    );
  }

  @Patch('pawnshops/:id/toggle-status')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async togglePawnshopStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.togglePawnshopStatus(userId, id);
  }

  @Patch('pawnshops/:id/settings')
  @RequiresPermission(PERMISSIONS['tenant.manage'])
  async updatePawnshopSettings(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: { settings: Record<string, unknown> },
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.updatePawnshopSettings(userId, id, body.settings);
  }

  @Post('pawnshops/:id/delete')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async deletePawnshop(
    @Headers('authorization') authHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.deletePawnshop(userId, id);
  }

  @Post('pawnshops')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async createPawnshopDirect(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: CreatePawnshopDirectDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.createPawnshopDirect(userId, dto);
  }

  @Post('invitations')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async inviteOwner(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: InviteOwnerDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.inviteOwner(userId, dto);
  }

  @Get('analytics/platform')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async getPlatformAnalytics(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.getPlatformAnalytics(userId);
  }

  @Post('subscriptions/:pawnshopId/extend-trial')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async extendTrial(
    @Headers('authorization') authHeader: string | undefined,
    @Param('pawnshopId') pawnshopId: string,
    @Body() dto: ExtendTrialDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.extendTrial(userId, pawnshopId, dto);
  }

  @Post('subscriptions/:pawnshopId/upgrade-tier')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async upgradeTier(
    @Headers('authorization') authHeader: string | undefined,
    @Param('pawnshopId') pawnshopId: string,
    @Body() dto: UpgradeTierDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.upgradeTier(userId, pawnshopId, dto);
  }

  @Patch('subscriptions/:pawnshopId/status')
  @RequiresPermission(PERMISSIONS['platform.manage'])
  async adjustSubscriptionStatus(
    @Headers('authorization') authHeader: string | undefined,
    @Param('pawnshopId') pawnshopId: string,
    @Body() dto: AdjustSubscriptionStatusDto,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.adjustSubscriptionStatus(userId, pawnshopId, dto);
  }

  @Post('subscriptions/request-extension')
  @RequiresPermission(PERMISSIONS['tenant.manage'])
  async requestTrialExtension(
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const userId = await this.authUserService.getUserIdFromAuthHeader(authHeader);
    return this.tenantGovernanceService.requestTrialExtension(userId, {});
  }
}
