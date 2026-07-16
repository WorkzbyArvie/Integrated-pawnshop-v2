import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { BillingInterval, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma.service';
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

type ProfileIdentity = {
  id: string;
  role: string;
  pawnshopId: string | null;
  email: string | null;
};

@Injectable()
export class TenantGovernanceService {
  private readonly logger = new Logger(TenantGovernanceService.name);
  private supportChatSchemaReady = false;
  private registrationChatSchemaReady = false;
  private readonly allowedTrialModuleLabels = [
    'Inventory Vault',
    'Finance & Treasury',
    'Customer CRM',
    'Staff Matrix',
    'Decision Support',
    'Auto-Reminders',
  ] as const;

  private readonly trialModuleToFeatureKey: Record<string, string> = {
    'Inventory Vault': 'vault_enabled',
    'Finance & Treasury': 'finance_enabled',
    'Customer CRM': 'crm_enabled',
    'Staff Matrix': 'hr_enabled',
    'Auction House': 'auction_enabled',
    'Decision Support': 'decision_enabled',
    'Auto-Reminders': 'alerts_enabled',
  };

  private readonly featureFlags = [
    'vault_enabled',
    'finance_enabled',
    'crm_enabled',
    'hr_enabled',
    'auction_enabled',
    'decision_enabled',
    'alerts_enabled',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  private normalizeRequestedModules(rawModules: unknown): string[] {
    if (!Array.isArray(rawModules)) {
      return [];
    }

    const normalized = rawModules
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .filter((item) => this.allowedTrialModuleLabels.includes(item as any));

    return Array.from(new Set(normalized));
  }

  private toConfiguredFeatureKeys(
    requestedModules: string[],
    options?: { excludeAuction?: boolean },
  ): string[] {
    const excludeAuction = options?.excludeAuction === true;
    const keys = requestedModules
      .map((moduleLabel) => this.trialModuleToFeatureKey[moduleLabel])
      .filter((key) => Boolean(key))
      .filter((key) => !(excludeAuction && key === 'auction_enabled'));

    return Array.from(new Set(keys));
  }

  private buildPawnshopFeatureSettings(enabledKeys: string[]): Record<string, unknown> {
    const enabledSet = new Set(enabledKeys);
    return this.featureFlags.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = enabledSet.has(key);
      return acc;
    }, {});
  }

  private async getProfileOrThrow(userId: string): Promise<ProfileIdentity> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        pawnshopId: true,
        email: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found for authenticated user');
    }

    return profile;
  }

  private normalizeRole(role: string | null | undefined): string {
    const normalized = (role || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (normalized === 'BRANCH_ADMIN') {
      return 'ADMIN';
    }
    if (normalized === 'SHOP_ADMIN') {
      return 'ADMIN';
    }
    if (normalized === 'SUPER') {
      return 'SUPER_ADMIN';
    }

    return normalized;
  }

  private assertRole(profile: ProfileIdentity, allowedRoles: string[]): void {
    const normalized = this.normalizeRole(profile.role);
    const normalizedAllowed = allowedRoles.map((role) => this.normalizeRole(role));
    if (!normalizedAllowed.includes(normalized)) {
      throw new ForbiddenException('Insufficient role permission for this action');
    }
  }

  private async logAudit(params: {
    pawnshopId: string;
    actorUserId: string;
    action: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO public.tenant_audit_logs
      (pawnshop_id, actor_user_id, action, metadata)
      VALUES (${params.pawnshopId}::uuid, ${params.actorUserId}::uuid, ${params.action}, ${JSON.stringify(params.metadata)}::jsonb)
    `;
  }

  private async resolveBranchLimit(pawnshopId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ max_branches: number | null }>>`
      SELECT max_branches
      FROM public.subscriptions
      WHERE pawnshop_id = ${pawnshopId}::uuid
        AND status IN ('ACTIVE', 'TRIAL')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    // Fallback to FREE tier behavior if no active subscription row exists.
    return rows[0]?.max_branches ?? 1;
  }

  private parseBranchId(branchId: string): number {
    const parsed = Number.parseInt(branchId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('branchId must be a positive integer');
    }
    return parsed;
  }

  private async assertSuperAdminHasApprovedAccess(
    actor: ProfileIdentity,
    pawnshopId: string,
    requestedAction: string,
  ): Promise<void> {
    if (this.normalizeRole(actor.role) !== 'SUPER_ADMIN') {
      return;
    }

    const grants = await this.prisma.$queryRaw<Array<{ id: string; expires_at: Date }>>`
      SELECT id, expires_at
      FROM public.support_access_grants
      WHERE pawnshop_id = ${pawnshopId}::uuid
        AND granted_to = ${actor.id}::uuid
        AND status = 'ACTIVE'
        AND expires_at > NOW()
      ORDER BY expires_at DESC
      LIMIT 1
    `;

    const grant = grants[0];
    if (!grant) {
      throw new ForbiddenException(
        'No active approved support-access grant for this pawnshop. Request tenant approval first.',
      );
    }

    await this.logAudit({
      pawnshopId,
      actorUserId: actor.id,
      action: 'SUPPORT_ACCESS_USED',
      metadata: {
        grantId: grant.id,
        requestedAction,
        expiresAt: grant.expires_at,
      },
    });
  }

  private async ensureSupportChatTables(): Promise<void> {
    if (this.supportChatSchemaReady) {
      return;
    }

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.support_chat_conversations (
        id uuid PRIMARY KEY,
        pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
        subject text NOT NULL,
        status text NOT NULL DEFAULT 'OPEN',
        created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        last_message_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.support_chat_messages (
        id uuid PRIMARY KEY,
        conversation_id uuid NOT NULL REFERENCES public.support_chat_conversations(id) ON DELETE CASCADE,
        pawnshop_id uuid NOT NULL REFERENCES public.pawnshops(id) ON DELETE CASCADE,
        sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        sender_role text NOT NULL CHECK (sender_role IN ('TENANT', 'PLATFORM')),
        message text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_support_chat_conversations_pawnshop_lastmsg
      ON public.support_chat_conversations (pawnshop_id, last_message_at DESC)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_support_chat_messages_conversation_created
      ON public.support_chat_messages (conversation_id, created_at ASC)
    `);

    this.supportChatSchemaReady = true;
  }

  private async ensureRegistrationChatTables(): Promise<void> {
    if (this.registrationChatSchemaReady) {
      return;
    }

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.client_registration_requests (
        id uuid PRIMARY KEY,
        pawnshop_name text NOT NULL,
        owner_name text NOT NULL,
        owner_email text NOT NULL,
        contact_number text,
        selected_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
        staff_count integer NOT NULL DEFAULT 1,
        notes text,
        status text NOT NULL DEFAULT 'PENDING',
        handled_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
        handled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      ALTER TABLE public.client_registration_requests
      ADD COLUMN IF NOT EXISTS contact_number text,
      ADD COLUMN IF NOT EXISTS selected_modules jsonb,
      ADD COLUMN IF NOT EXISTS staff_count integer,
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS handled_by uuid,
      ADD COLUMN IF NOT EXISTS handled_at timestamptz,
      ADD COLUMN IF NOT EXISTS created_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_client_registration_requests_owner_email
      ON public.client_registration_requests (lower(owner_email))
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_client_registration_requests_status_created
      ON public.client_registration_requests (status, created_at DESC)
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.client_registration_messages (
        id uuid PRIMARY KEY,
        request_id uuid NOT NULL REFERENCES public.client_registration_requests(id) ON DELETE CASCADE,
        sender_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
        sender_type text NOT NULL CHECK (sender_type IN ('OWNER', 'SUPER_ADMIN', 'SYSTEM')),
        message text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_client_registration_messages_request_created
      ON public.client_registration_messages (request_id, created_at ASC)
    `);

    this.registrationChatSchemaReady = true;
  }

  private async getClientRegistrationRequestOrThrow(
    requestId: string,
  ): Promise<{ id: string; owner_email: string; status: string }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; owner_email: string; status: string }>
    >`
      SELECT id, owner_email, status
      FROM public.client_registration_requests
      WHERE id = ${requestId}::uuid
      LIMIT 1
    `;

    const request = rows[0];
    if (!request) {
      throw new NotFoundException('Client registration request not found');
    }

    return request;
  }

  private async assertClientRegistrationMessageAccess(
    actorUserId: string,
    requestId: string,
  ): Promise<{ request: { id: string; owner_email: string; status: string }; actor: ProfileIdentity }> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const request = await this.getClientRegistrationRequestOrThrow(requestId);

    const role = this.normalizeRole(actor.role);
    if (role === 'SUPER_ADMIN') {
      return { request, actor };
    }

    const actorEmail = actor.email?.trim().toLowerCase();
    const requestEmail = request.owner_email.trim().toLowerCase();
    if (!actorEmail || actorEmail !== requestEmail) {
      throw new ForbiddenException('You do not have access to this registration conversation');
    }

    return { request, actor };
  }

  async getPawnshopMetadata(superAdminUserId: string): Promise<any[]> {
    const actor = await this.getProfileOrThrow(superAdminUserId);
    this.assertRole(actor, ['SUPER_ADMIN']);

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      SELECT
        p.id,
        p.name,
        p.status,
        p.owner_email,
        p.contact_email,
        p.created_at,
        s.tier AS subscription_tier,
        s.status AS subscription_status,
        s.end_date AS subscription_end_date
      FROM public.pawnshops p
      LEFT JOIN LATERAL (
        SELECT tier, status, end_date
        FROM public.subscriptions ss
        WHERE ss.pawnshop_id = p.id
        ORDER BY ss.created_at DESC
        LIMIT 1
      ) s ON true
      ORDER BY p.created_at DESC
    `;

    return rows;
  }

  async requestSupportAccess(
    superAdminUserId: string,
    dto: RequestSupportAccessDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(superAdminUserId);
    this.assertRole(actor, ['SUPER_ADMIN']);

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: dto.pawnshopId },
      select: { id: true, name: true, ownerEmail: true },
    });

    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const requestedHours = dto.requestedHours ?? 4;

    const existingPending = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM public.support_access_requests
      WHERE pawnshop_id = ${dto.pawnshopId}::uuid
        AND status = 'PENDING'
      LIMIT 1
    `;

    if (existingPending.length > 0) {
      throw new BadRequestException('There is already a pending support access request for this pawnshop');
    }

    const created = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.support_access_requests
      (pawnshop_id, requested_by, reason, requested_hours, status)
      VALUES (${dto.pawnshopId}::uuid, ${superAdminUserId}::uuid, ${dto.reason}, ${requestedHours}, 'PENDING')
      RETURNING id, pawnshop_id, requested_by, reason, requested_hours, status, requested_at
    `;

    await this.logAudit({
      pawnshopId: dto.pawnshopId,
      actorUserId: superAdminUserId,
      action: 'SUPPORT_ACCESS_REQUESTED',
      metadata: {
        reason: dto.reason,
        requestedHours,
      },
    });

    return {
      success: true,
      request: created[0],
      message: 'Support access request submitted. Awaiting tenant approval.',
    };
  }

  async approveSupportAccess(
    approverUserId: string,
    requestId: string,
    dto: ApproveSupportAccessDto,
  ): Promise<Record<string, unknown>> {
    const approver = await this.getProfileOrThrow(approverUserId);
    this.assertRole(approver, ['OWNER', 'ADMIN']);

    const requests = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_id: string;
      requested_by: string;
      requested_hours: number;
      status: string;
    }>>`
      SELECT id, pawnshop_id, requested_by, requested_hours, status
      FROM public.support_access_requests
      WHERE id = ${requestId}::uuid
      LIMIT 1
    `;

    const request = requests[0];
    if (!request) {
      throw new NotFoundException('Support access request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending support access requests can be approved');
    }

    if (approver.pawnshopId !== request.pawnshop_id) {
      throw new ForbiddenException('You can only approve requests for your own pawnshop');
    }

    const grantedHours = dto.approvedHours ?? request.requested_hours;
    const expiresAt = new Date(Date.now() + grantedHours * 60 * 60 * 1000);

    const grantRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.support_access_grants
      (request_id, pawnshop_id, granted_to, approved_by, expires_at, status)
      VALUES (
        ${requestId}::uuid,
        ${request.pawnshop_id}::uuid,
        ${request.requested_by}::uuid,
        ${approverUserId}::uuid,
        ${expiresAt},
        'ACTIVE'
      )
      RETURNING id, request_id, pawnshop_id, granted_to, approved_by, expires_at, status, granted_at
    `;

    await this.prisma.$executeRaw`
      UPDATE public.support_access_requests
      SET status = 'APPROVED', approved_by = ${approverUserId}::uuid, approved_at = NOW(), approval_notes = ${dto.notes ?? null}
      WHERE id = ${requestId}::uuid
    `;

    await this.logAudit({
      pawnshopId: request.pawnshop_id,
      actorUserId: approverUserId,
      action: 'SUPPORT_ACCESS_APPROVED',
      metadata: {
        requestId,
        approvedHours: grantedHours,
        expiresAt,
      },
    });

    return {
      success: true,
      grant: grantRows[0],
      message: 'Support access approved and time-boxed grant activated.',
    };
  }

  async revokeSupportAccess(
    actorUserId: string,
    grantId: string,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['SUPER_ADMIN', 'OWNER', 'ADMIN']);

    const grants = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_id: string;
      status: string;
    }>>`
      SELECT id, pawnshop_id, status
      FROM public.support_access_grants
      WHERE id = ${grantId}::uuid
      LIMIT 1
    `;

    const grant = grants[0];
    if (!grant) {
      throw new NotFoundException('Support access grant not found');
    }

    if (grant.status !== 'ACTIVE') {
      throw new BadRequestException('Only active grants can be revoked');
    }

    if (
      this.normalizeRole(actor.role) !== 'SUPER_ADMIN' &&
      actor.pawnshopId !== grant.pawnshop_id
    ) {
      throw new ForbiddenException('You can only revoke access for your own pawnshop');
    }

    await this.prisma.$executeRaw`
      UPDATE public.support_access_grants
      SET status = 'REVOKED', revoked_at = NOW(), revoked_by = ${actorUserId}::uuid
      WHERE id = ${grantId}::uuid
    `;

    await this.logAudit({
      pawnshopId: grant.pawnshop_id,
      actorUserId,
      action: 'SUPPORT_ACCESS_REVOKED',
      metadata: { grantId },
    });

    return {
      success: true,
      message: 'Support access grant revoked.',
    };
  }

  async getSupportAccessAudit(
    actorUserId: string,
    pawnshopId?: string,
  ): Promise<Record<string, unknown>[]> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    if (!['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(role)) {
      throw new ForbiddenException('Only SUPER_ADMIN, OWNER, or ADMIN may view support audit logs');
    }

    const scopedPawnshopId =
      role === 'SUPER_ADMIN' ? pawnshopId ?? null : actor.pawnshopId;

    if (!scopedPawnshopId) {
      throw new BadRequestException('pawnshopId is required for SUPER_ADMIN audit queries');
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
        SELECT id, pawnshop_id, actor_user_id, action, metadata, created_at
        FROM public.tenant_audit_logs
        WHERE pawnshop_id = ${scopedPawnshopId}::uuid
        ORDER BY created_at DESC
        LIMIT 200
      `;
      return rows;
    } catch {
      return [];
    }
  }

  async getTenantAuditHistory(
    actorUserId: string,
    pawnshopId?: string,
    limit = 250,
  ): Promise<Record<string, unknown>[]> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    if (!['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      throw new ForbiddenException('Only OWNER, ADMIN, or SUPER_ADMIN may view tenant audit history');
    }

    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 500)
      : 250;

    const scopedPawnshopId = role === 'SUPER_ADMIN' ? pawnshopId ?? null : actor.pawnshopId;

    if (!scopedPawnshopId) {
      throw new BadRequestException('pawnshopId is required for SUPER_ADMIN tenant audit queries');
    }

    if (role === 'SUPER_ADMIN') {
      await this.assertSuperAdminHasApprovedAccess(actor, scopedPawnshopId, 'VIEW_TENANT_AUDIT_HISTORY');
    }

    try {
      if (role === 'OWNER' || role === 'SUPER_ADMIN') {
        return await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT
            l.id,
            l.pawnshop_id,
            l.actor_user_id,
            p.email AS actor_email,
            p.full_name AS actor_name,
            l.action,
            l.metadata,
            l.created_at
          FROM public.tenant_audit_logs l
          LEFT JOIN public.profiles p ON p.id = l.actor_user_id
          WHERE l.pawnshop_id = ${scopedPawnshopId}::uuid
          ORDER BY l.created_at DESC
          LIMIT ${safeLimit}
        `;
      }

      return await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT
          l.id,
          l.pawnshop_id,
          l.actor_user_id,
          p.email AS actor_email,
          p.full_name AS actor_name,
          l.action,
          l.metadata,
          l.created_at
        FROM public.tenant_audit_logs l
        LEFT JOIN public.profiles p ON p.id = l.actor_user_id
        WHERE l.pawnshop_id = ${scopedPawnshopId}::uuid
          AND (
            l.action ILIKE 'STAFF_%'
            OR l.action ILIKE '%STAFF%'
            OR l.action ILIKE 'TRANSACTION_%'
            OR l.action ILIKE '%TRANSACTION%'
            OR l.action ILIKE 'OPERATIONAL_%'
            OR l.action ILIKE '%OPERATION%'
            OR l.action IN (
              'BRANCH_CREATED',
              'BRANCH_UPDATED',
              'BRANCH_ACTIVATED',
              'BRANCH_DEACTIVATED'
            )
          )
        ORDER BY l.created_at DESC
        LIMIT ${safeLimit}
      `;
    } catch {
      return [];
    }
  }

  async getSupportAccessStatus(
    actorUserId: string,
    pawnshopId?: string,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const role = (actor.role || '').toUpperCase();

    if (role !== 'SUPER_ADMIN') {
      return {
        hasApprovedAccess: true,
        pawnshopId: pawnshopId ?? actor.pawnshopId,
        reason: 'NON_SUPER_ADMIN',
      };
    }

    if (!pawnshopId) {
      throw new BadRequestException('pawnshopId is required for SUPER_ADMIN support-access status checks');
    }

    let activeGrant:
      | {
          id: string;
          expires_at: Date;
          status: string;
        }
      | undefined;

    try {
      const grants = await this.prisma.$queryRaw<Array<{
        id: string;
        expires_at: Date;
        status: string;
      }>>`
        SELECT id, expires_at, status
        FROM public.support_access_grants
        WHERE pawnshop_id = ${pawnshopId}::uuid
          AND granted_to = ${actor.id}::uuid
          AND status = 'ACTIVE'
          AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1
      `;
      activeGrant = grants[0];
    } catch (error) {
      this.logger.warn(
        `Support access status lookup failed for pawnshop ${pawnshopId}: ${
          (error as Error)?.message || String(error)
        }`,
      );
      return {
        pawnshopId,
        hasApprovedAccess: false,
        grantId: null,
        expiresAt: null,
        status: 'UNAVAILABLE',
      };
    }

    return {
      pawnshopId,
      hasApprovedAccess: Boolean(activeGrant),
      grantId: activeGrant?.id ?? null,
      expiresAt: activeGrant?.expires_at ?? null,
      status: activeGrant ? activeGrant.status : 'INACTIVE',
    };
  }

  async listSupportAccessRequests(
    actorUserId: string,
    pawnshopId?: string,
    status?: string,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const role = (actor.role || '').toUpperCase();

    const allowedStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
    const normalizedStatus = status ? status.toUpperCase() : undefined;
    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException('status must be PENDING, APPROVED, or REJECTED');
    }

    let scopedPawnshopId: string | null;
    if (role === 'SUPER_ADMIN') {
      scopedPawnshopId = pawnshopId ?? null;
    } else {
      this.assertRole(actor, ['OWNER', 'ADMIN', 'MANAGER']);
      if (!actor.pawnshopId) {
        throw new BadRequestException('Your profile is not linked to a pawnshop');
      }
      scopedPawnshopId = actor.pawnshopId;
    }

    const statusFilter = normalizedStatus ?? null;

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      SELECT
        r.id,
        r.pawnshop_id,
        p.name AS pawnshop_name,
        r.requested_by,
        requester.email AS requested_by_email,
        r.reason,
        r.requested_hours,
        r.status,
        r.requested_at,
        r.approved_by,
        approver.email AS approved_by_email,
        r.approved_at,
        r.approval_notes
      FROM public.support_access_requests r
      LEFT JOIN public.pawnshops p ON p.id = r.pawnshop_id
      LEFT JOIN public.profiles requester ON requester.id = r.requested_by
      LEFT JOIN public.profiles approver ON approver.id = r.approved_by
      WHERE
        (${scopedPawnshopId}::uuid IS NULL OR r.pawnshop_id = ${scopedPawnshopId}::uuid)
        AND (${statusFilter}::text IS NULL OR r.status = ${statusFilter})
      ORDER BY r.requested_at DESC
      LIMIT 200
    `;

    return {
      requests: rows,
    };
  }

  async configureOnboarding(
    actorUserId: string,
    dto: ConfigureOnboardingDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['OWNER', 'ADMIN']);

    if (actor.pawnshopId !== dto.pawnshopId) {
      throw new ForbiddenException('Onboarding configuration is restricted to your pawnshop');
    }

    const modulesJson = JSON.stringify(dto.selectedModules || []);
    const roleAssignmentsJson = JSON.stringify(dto.roleAssignments || {});

    await this.prisma.$executeRaw`
      INSERT INTO public.tenant_module_configs
      (pawnshop_id, selected_modules, staff_count, role_assignments, configured_by)
      VALUES (${dto.pawnshopId}::uuid, ${modulesJson}::jsonb, ${dto.staffCount}, ${roleAssignmentsJson}::jsonb, ${actorUserId}::uuid)
      ON CONFLICT (pawnshop_id)
      DO UPDATE SET
        selected_modules = EXCLUDED.selected_modules,
        staff_count = EXCLUDED.staff_count,
        role_assignments = EXCLUDED.role_assignments,
        configured_by = EXCLUDED.configured_by,
        updated_at = NOW()
    `;

    await this.logAudit({
      pawnshopId: dto.pawnshopId,
      actorUserId,
      action: 'TENANT_ONBOARDING_CONFIGURED',
      metadata: {
        staffCount: dto.staffCount,
        selectedModules: dto.selectedModules,
        roleAssignments: dto.roleAssignments || {},
      },
    });

    return {
      success: true,
      message: 'Onboarding module configuration saved.',
    };
  }

  async updateBranding(
    actorUserId: string,
    dto: UpdateBrandingDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['OWNER', 'ADMIN']);

    const pawnshopId = dto.pawnshopId || actor.pawnshopId;
    if (!pawnshopId) {
      throw new BadRequestException('pawnshopId is required');
    }

    if (actor.pawnshopId !== pawnshopId) {
      throw new ForbiddenException('Branding updates are restricted to your pawnshop');
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: pawnshopId },
      select: { id: true, name: true },
    });
    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const subscriptions = await this.prisma.$queryRaw<Array<{ features: unknown }>>`
      SELECT features
      FROM public.subscriptions
      WHERE pawnshop_id = ${pawnshopId}::uuid
        AND status IN ('ACTIVE', 'TRIAL')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const features = subscriptions[0]?.features as Record<string, unknown> | undefined;
    const customBrandingEnabled = Boolean(features?.custom_branding === true);

    if (!customBrandingEnabled) {
      throw new ForbiddenException(
        'Custom branding is available on the Enterprise plan only.',
      );
    }

    const displayName = customBrandingEnabled
      ? dto.displayName || pawnshop.name
      : pawnshop.name;
    const logoUrl = customBrandingEnabled ? dto.logoUrl || null : null;
    const primaryColor = customBrandingEnabled
      ? dto.primaryColor || '#D4AF37'
      : '#D4AF37';
    const secondaryColor = customBrandingEnabled
      ? dto.secondaryColor || '#141416'
      : '#141416';

    await this.prisma.$executeRaw`
      INSERT INTO public.tenant_branding_profiles
      (pawnshop_id, display_name, logo_url, primary_color, secondary_color, custom_enabled, updated_by)
      VALUES (
        ${pawnshopId}::uuid,
        ${displayName},
        ${logoUrl},
        ${primaryColor},
        ${secondaryColor},
        ${customBrandingEnabled},
        ${actorUserId}::uuid
      )
      ON CONFLICT (pawnshop_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        logo_url = EXCLUDED.logo_url,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        custom_enabled = EXCLUDED.custom_enabled,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `;

    await this.logAudit({
      pawnshopId,
      actorUserId,
      action: 'TENANT_BRANDING_UPDATED',
      metadata: {
        customBrandingEnabled,
        displayName,
      },
    });

    return {
      success: true,
      branding: {
        pawnshopId,
        displayName,
        logoUrl,
        primaryColor,
        secondaryColor,
        customBrandingEnabled,
      },
      message: 'Custom branding updated.',
    };
  }

  async getEffectiveBranding(
    actorUserId: string,
    pawnshopId?: string,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const normalizedRole = (actor.role || '').toUpperCase();

    let effectivePawnshopId: string | null = null;
    if (normalizedRole === 'SUPER_ADMIN') {
      effectivePawnshopId = pawnshopId || null;
    } else {
      effectivePawnshopId = actor.pawnshopId;
      if (pawnshopId && pawnshopId !== effectivePawnshopId) {
        throw new ForbiddenException('Branding access is restricted to your pawnshop');
      }
    }

    if (!effectivePawnshopId) {
      return {
        success: true,
        branding: {
          pawnshopId: null,
          pawnshopName: null,
          displayName: 'PawnGold',
          logoUrl: null,
          primaryColor: '#4F46E5',
          secondaryColor: '#030213',
          customBrandingEnabled: false,
        },
      };
    }

    const pawnshop = await this.prisma.pawnshop.findUnique({
      where: { id: effectivePawnshopId },
      select: { id: true, name: true },
    });
    if (!pawnshop) {
      throw new NotFoundException('Pawnshop not found');
    }

    const subscriptions = await this.prisma.$queryRaw<Array<{ features: unknown }>>`
      SELECT features
      FROM public.subscriptions
      WHERE pawnshop_id = ${effectivePawnshopId}::uuid
        AND status IN ('ACTIVE', 'TRIAL')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const features = subscriptions[0]?.features as Record<string, unknown> | undefined;
    const customBrandingEnabled = Boolean(features?.custom_branding === true);

    let brandingRow:
      | {
          display_name: string | null;
          logo_url: string | null;
          primary_color: string | null;
          secondary_color: string | null;
        }
      | undefined;

    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          display_name: string | null;
          logo_url: string | null;
          primary_color: string | null;
          secondary_color: string | null;
        }>
      >`
        SELECT display_name, logo_url, primary_color, secondary_color
        FROM public.tenant_branding_profiles
        WHERE pawnshop_id = ${effectivePawnshopId}::uuid
        LIMIT 1
      `;
      brandingRow = rows[0];
    } catch (error) {
      this.logger.warn(
        `Branding profile lookup skipped for pawnshop ${effectivePawnshopId}: ${(error as Error).message}`,
      );
    }

    const displayName = customBrandingEnabled
      ? brandingRow?.display_name || pawnshop.name
      : pawnshop.name;
    const logoUrl = customBrandingEnabled ? brandingRow?.logo_url || null : null;
    const primaryColor = customBrandingEnabled
      ? brandingRow?.primary_color || '#D4AF37'
      : '#D4AF37';
    const secondaryColor = customBrandingEnabled
      ? brandingRow?.secondary_color || '#141416'
      : '#141416';

    return {
      success: true,
      branding: {
        pawnshopId: pawnshop.id,
        pawnshopName: pawnshop.name,
        displayName,
        logoUrl,
        primaryColor,
        secondaryColor,
        customBrandingEnabled,
      },
    };
  }

  async createClientRegistration(
    dto: CreateClientRegistrationDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureRegistrationChatTables();

    const requestedModules = this.normalizeRequestedModules(dto.selectedModules);
    if (requestedModules.length === 0) {
      throw new BadRequestException('Please select at least one valid module option.');
    }

    const selectedModulesJson = JSON.stringify(requestedModules);

    const existing = await this.prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM public.client_registration_requests
      WHERE lower(owner_email) = lower(${dto.ownerEmail})
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (existing[0]?.status === 'PENDING') {
      throw new BadRequestException('A pending registration request already exists for this email.');
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.client_registration_requests
      (
        id,
        pawnshop_name,
        owner_name,
        owner_email,
        contact_number,
        selected_modules,
        staff_count,
        notes,
        status
      )
      VALUES
      (
        ${randomUUID()}::uuid,
        ${dto.pawnshopName},
        ${dto.ownerName},
        ${dto.ownerEmail},
        ${dto.contactNumber ?? null},
        ${selectedModulesJson}::jsonb,
        ${dto.staffCount},
        ${dto.notes ?? null},
        'PENDING'
      )
      RETURNING id, pawnshop_name, owner_name, owner_email, status, created_at
    `;

    this.logger.log(
      `New client registration request submitted for ${dto.ownerEmail} / ${dto.pawnshopName}`,
    );

    const requestId = rows[0]?.id as string;
    if (requestId) {
      await this.prisma.$executeRaw`
        INSERT INTO public.client_registration_messages
        (id, request_id, sender_user_id, sender_type, message, created_at)
        VALUES
        (
          ${randomUUID()}::uuid,
          ${requestId}::uuid,
          NULL,
          'SYSTEM',
          ${'Registration request created. Our onboarding team will review your submission shortly.'},
          NOW()
        )
      `;
    }

    return {
      success: true,
      request: rows[0],
      message: 'Registration request submitted. Our onboarding team will contact you shortly.',
    };
  }

  async createClientRegistrationForOwner(
    actorUserId: string,
    dto: CreateClientRegistrationDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const ownerEmail = actor.email?.trim();

    if (!ownerEmail) {
      throw new BadRequestException('Your profile email is missing. Please update your account email first.');
    }

    // Always bind registration ownership to the authenticated owner email.
    return this.createClientRegistration({
      ...dto,
      ownerEmail,
    });
  }

  async listMyClientRegistrationRequests(
    actorUserId: string,
  ): Promise<Record<string, unknown>[]> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const ownerEmail = actor.email?.trim();

    if (!ownerEmail) {
      throw new BadRequestException('Your profile email is missing. Please update your account email first.');
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
        SELECT
          id,
          pawnshop_name,
          owner_name,
          owner_email,
          contact_number,
          selected_modules,
          staff_count,
          notes,
          status,
          handled_by,
          handled_at,
          created_at,
          updated_at
        FROM public.client_registration_requests
        WHERE lower(owner_email) = lower(${ownerEmail})
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return rows;
    } catch {
      return [];
    }
  }

  async listClientRegistrationRequests(
    actorUserId: string,
    status?: string,
    _scopeId?: string,
  ): Promise<Record<string, unknown>[]> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['SUPER_ADMIN']);

    const normalizedStatus = status?.trim().toUpperCase();
    const allowedStatuses = ['PENDING', 'CONTACTED', 'APPROVED', 'REJECTED', 'CANCELLED'];

    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException('Invalid status filter');
    }

    if (normalizedStatus) {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
        SELECT
          id,
          pawnshop_name,
          owner_name,
          owner_email,
          contact_number,
          selected_modules,
          staff_count,
          notes,
          status,
          handled_by,
          handled_at,
          created_at,
          updated_at
        FROM public.client_registration_requests
        WHERE status = ${normalizedStatus}
        ORDER BY created_at DESC
        LIMIT 500
      `;

      return rows;
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      SELECT
        id,
        pawnshop_name,
        owner_name,
        owner_email,
        contact_number,
        selected_modules,
        staff_count,
        notes,
        status,
        handled_by,
        handled_at,
        created_at,
        updated_at
      FROM public.client_registration_requests
      ORDER BY created_at DESC
      LIMIT 500
    `;

    return rows;
  }

  async reviewClientRegistrationRequest(
    actorUserId: string,
    requestId: string,
    dto: ReviewClientRegistrationDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureRegistrationChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['SUPER_ADMIN']);

    const decision = dto.decision.toUpperCase() as
      | 'CONTACTED'
      | 'APPROVED'
      | 'REJECTED';

    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_name: string;
      owner_name: string;
      owner_email: string;
      contact_number: string | null;
      selected_modules: unknown;
      staff_count: number;
      notes: string | null;
      status: string;
    }>>`
      SELECT
        id,
        pawnshop_name,
        owner_name,
        owner_email,
        contact_number,
        selected_modules,
        staff_count,
        notes,
        status
      FROM public.client_registration_requests
      WHERE id = ${requestId}::uuid
      LIMIT 1
    `;

    const request = rows[0];
    if (!request) {
      throw new NotFoundException('Client registration request not found');
    }

    if (
      ['APPROVED', 'REJECTED', 'CANCELLED'].includes(request.status) &&
      decision !== request.status
    ) {
      throw new BadRequestException(
        'Finalized requests cannot be changed to a different decision',
      );
    }

    let createdPawnshop: Record<string, unknown> | null = null;

    if (decision === 'APPROVED') {
      const existingPawnshop = await this.prisma.pawnshop.findFirst({
        where: {
          OR: [
            { name: request.pawnshop_name },
            { ownerEmail: request.owner_email },
          ],
        },
        select: { id: true, name: true, ownerEmail: true },
      });

      if (existingPawnshop) {
        throw new BadRequestException(
          'A pawnshop with this name or owner email already exists',
        );
      }

      const requestedModules = this.normalizeRequestedModules(
        request.selected_modules,
      );
      const configuredModuleKeys = this.toConfiguredFeatureKeys(requestedModules, {
        excludeAuction: true,
      });
      const moduleFeatureSettings = this.buildPawnshopFeatureSettings(
        configuredModuleKeys,
      );

      const settingsPayload: Prisma.InputJsonValue = {
        ...moduleFeatureSettings,
        onboardingSource: 'client_registration_request',
        ownerName: request.owner_name,
        requestedModules,
        approvedModules: configuredModuleKeys,
        auctionExcludedAtApproval: requestedModules.includes('Auction House'),
      };

      const pawnshop = await this.prisma.pawnshop.create({
        data: {
          name: request.pawnshop_name,
          ownerEmail: request.owner_email,
          contactEmail: request.owner_email,
          contactPhone: request.contact_number,
          status: 'ACTIVE',
          isActive: true,
          settings: settingsPayload,
        },
        select: {
          id: true,
          name: true,
          ownerEmail: true,
          contactEmail: true,
          status: true,
          createdAt: true,
        },
      });

      createdPawnshop = pawnshop as unknown as Record<string, unknown>;

      const selectedModules = JSON.stringify(configuredModuleKeys);

      await this.prisma.$executeRaw`
        INSERT INTO public.tenant_module_configs
        (pawnshop_id, selected_modules, staff_count, role_assignments, configured_by)
        VALUES (
          ${pawnshop.id}::uuid,
          ${selectedModules}::jsonb,
          ${request.staff_count},
          ${JSON.stringify({})}::jsonb,
          ${actorUserId}::uuid
        )
        ON CONFLICT (pawnshop_id)
        DO UPDATE SET
          selected_modules = EXCLUDED.selected_modules,
          staff_count = EXCLUDED.staff_count,
          configured_by = EXCLUDED.configured_by,
          updated_at = NOW()
      `;

      const existingOwnerInvite = await this.prisma.adminInvite.findFirst({
        where: {
          email: request.owner_email.toLowerCase(),
          pawnshopId: pawnshop.id,
        },
        select: { id: true },
      });

      if (existingOwnerInvite) {
        await this.prisma.adminInvite.update({
          where: { id: existingOwnerInvite.id },
          data: { role: 'OWNER' },
        });
      } else {
        await this.prisma.adminInvite.create({
          data: {
            email: request.owner_email.toLowerCase(),
            pawnshopId: pawnshop.id,
            role: 'OWNER',
          },
        });
      }

      // Activate owner account by linking profile to the approved pawnshop.
      await this.prisma.$executeRaw`
        UPDATE public.profiles
        SET
          pawnshop_id = ${pawnshop.id}::uuid,
          role = 'OWNER',
          updated_at = NOW()
        WHERE email IS NOT NULL
          AND lower(email) = lower(${request.owner_email})
          AND upper(replace(COALESCE(role, ''), ' ', '_')) <> 'SUPER_ADMIN'
      `;

      // Seed a 15-day trial subscription only once in tenant lifetime.
      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(trialEndDate.getDate() + 15);
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);

      const existingSub = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId: pawnshop.id,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE],
          },
        },
        select: { id: true },
      });

      const hasTrialHistory = await this.prisma.subscription.findFirst({
        where: {
          pawnshopId: pawnshop.id,
          trialEndDate: { not: null },
        },
        select: { id: true },
      });

      const hasAnySubscriptionHistory = await this.prisma.subscription.findFirst({
        where: { pawnshopId: pawnshop.id },
        select: { id: true },
      });

      if (!existingSub && !hasTrialHistory && !hasAnySubscriptionHistory) {
        await this.prisma.subscription.create({
          data: {
            pawnshopId: pawnshop.id,
            tier: SubscriptionTier.BASIC,
            status: SubscriptionStatus.TRIAL,
            billingInterval: BillingInterval.MONTHLY,
            price: 2999,
            startDate: now,
            endDate,
            trialEndDate,
            nextBillingDate: trialEndDate,
            maxBranches: 1,
            maxStaff: 3,
            maxTransactions: 100,
            autoRenew: false,
            features: {
              basic_analytics: true,
              queue_management: false,
              auction_access: false,
              api_access: false,
              priority_support: false,
              custom_branding: false,
            },
          },
        });
      }
    }

    const mergedNotes = [request.notes, dto.notes]
      .filter((item) => Boolean(item && item.trim().length > 0))
      .join('\n---\n');

    await this.prisma.$executeRaw`
      UPDATE public.client_registration_requests
      SET
        status = ${decision},
        notes = ${mergedNotes || null},
        handled_by = ${actorUserId}::uuid,
        handled_at = NOW(),
        updated_at = NOW()
      WHERE id = ${requestId}::uuid
    `;

    const decisionMessage =
      decision === 'APPROVED'
        ? 'Your trial request has been approved. You may proceed with onboarding setup.'
        : decision === 'CONTACTED'
          ? 'Your request was reviewed. Our team has contacted you for next steps.'
          : 'Your trial request was not approved at this time. Please review notes from support.';

    const systemMessage = dto.notes?.trim()
      ? `${decisionMessage}\n\nAdmin note: ${dto.notes.trim()}`
      : decisionMessage;

    await this.prisma.$executeRaw`
      INSERT INTO public.client_registration_messages
      (id, request_id, sender_user_id, sender_type, message, created_at)
      VALUES
      (
        ${randomUUID()}::uuid,
        ${requestId}::uuid,
        ${actorUserId}::uuid,
        'SYSTEM',
        ${systemMessage},
        NOW()
      )
    `;

    return {
      success: true,
      decision,
      pawnshop: createdPawnshop,
      message:
        decision === 'APPROVED'
          ? 'Client registration approved and pawnshop initialized.'
          : decision === 'CONTACTED'
            ? 'Client registration marked as contacted.'
            : 'Client registration rejected.',
    };
  }

  async cancelMyClientRegistrationRequest(
    actorUserId: string,
    requestId: string,
    dto: CancelClientRegistrationDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureRegistrationChatTables();
    const { request, actor } = await this.assertClientRegistrationMessageAccess(
      actorUserId,
      requestId,
    );

    if (this.normalizeRole(actor.role) === 'SUPER_ADMIN') {
      throw new ForbiddenException('Super Admin cannot use owner cancellation endpoint');
    }

    const currentRows = await this.prisma.$queryRaw<
      Array<{ id: string; status: string; notes: string | null }>
    >`
      SELECT id, status, notes
      FROM public.client_registration_requests
      WHERE id = ${request.id}::uuid
      LIMIT 1
    `;

    const current = currentRows[0];
    if (!current) {
      throw new NotFoundException('Client registration request not found');
    }

    const currentStatus = current.status.toUpperCase();
    const currentNotes = current.notes ?? '';
    const alreadyOwnerCancelled = currentNotes
      .toUpperCase()
      .includes('OWNER_CANCELLED:');

    if (currentStatus === 'APPROVED') {
      throw new BadRequestException('Approved trial requests can no longer be cancelled');
    }

    if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
      if (alreadyOwnerCancelled || currentStatus === 'CANCELLED') {
        return {
          success: true,
          status: 'CANCELLED',
          message: 'Trial request was already cancelled.',
        };
      }

      throw new BadRequestException(
        'This trial request has already been closed by the onboarding team',
      );
    }

    const reason = dto.reason.trim();
    const cancellationNote = `OWNER_CANCELLED: ${reason}`;
    const mergedNotes = [current.notes, cancellationNote]
      .filter((item) => Boolean(item && item.trim().length > 0))
      .join('\n---\n');

    await this.prisma.$executeRaw`
      UPDATE public.client_registration_requests
      SET
        status = 'CANCELLED',
        notes = ${mergedNotes || null},
        handled_by = ${actorUserId}::uuid,
        handled_at = NOW(),
        updated_at = NOW()
      WHERE id = ${request.id}::uuid
    `;

    await this.prisma.$executeRaw`
      INSERT INTO public.client_registration_messages
      (id, request_id, sender_user_id, sender_type, message, created_at)
      VALUES
      (
        ${randomUUID()}::uuid,
        ${request.id}::uuid,
        ${actorUserId}::uuid,
        'SYSTEM',
        ${`Owner cancelled the trial request.\nReason: ${reason}`},
        NOW()
      )
    `;

    return {
      success: true,
      status: 'CANCELLED',
      message: 'Trial request cancelled successfully.',
    };
  }

  async listClientRegistrationMessages(
    actorUserId: string,
    requestId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.ensureRegistrationChatTables();
    await this.assertClientRegistrationMessageAccess(actorUserId, requestId);

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      SELECT
        m.id,
        m.request_id,
        m.sender_user_id,
        m.sender_type,
        m.message,
        m.created_at,
        p.full_name AS sender_name,
        p.email AS sender_email
      FROM public.client_registration_messages m
      LEFT JOIN public.profiles p ON p.id = m.sender_user_id
      WHERE m.request_id = ${requestId}::uuid
      ORDER BY m.created_at ASC
      LIMIT 500
    `;

    return rows;
  }

  async listClientRegistrationAttachments(
    actorUserId: string,
    requestId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.listClientRegistrationMessages(actorUserId, requestId);
  }

  async postClientRegistrationMessage(
    actorUserId: string,
    requestId: string,
    dto: PostClientRegistrationMessageDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureRegistrationChatTables();
    const { actor } = await this.assertClientRegistrationMessageAccess(actorUserId, requestId);

    const senderType = this.normalizeRole(actor.role) === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'OWNER';

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.client_registration_messages
      (id, request_id, sender_user_id, sender_type, message, created_at)
      VALUES
      (
        ${randomUUID()}::uuid,
        ${requestId}::uuid,
        ${actorUserId}::uuid,
        ${senderType},
        ${dto.message.trim()},
        NOW()
      )
      RETURNING id, request_id, sender_user_id, sender_type, message, created_at
    `;

    return {
      success: true,
      message: rows[0],
    };
  }

  async listBranches(
    actorUserId: string,
    pawnshopId?: string,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    let scopedPawnshopId: string | null = null;

    if (role === 'SUPER_ADMIN') {
      if (!pawnshopId) {
        throw new BadRequestException('pawnshopId is required for SUPER_ADMIN branch queries');
      }
      await this.assertSuperAdminHasApprovedAccess(
        actor,
        pawnshopId,
        'LIST_BRANCHES',
      );
      scopedPawnshopId = pawnshopId;
    } else {
      this.assertRole(actor, ['OWNER', 'ADMIN', 'MANAGER']);
      if (!actor.pawnshopId) {
        throw new BadRequestException('Your profile is not linked to a pawnshop');
      }
      if (pawnshopId && pawnshopId !== actor.pawnshopId) {
        throw new ForbiddenException('You can only access branches for your own pawnshop');
      }
      scopedPawnshopId = actor.pawnshopId;
    }

    const branchRows = await this.prisma.branch.findMany({
      where: {
        pawnshopId: scopedPawnshopId,
        ...(role !== 'OWNER' ? {} : {
          OR: [
            { ownerUserId: actor.id },
            { ownerUserId: null },
          ],
        }),
      },
      orderBy: { name: 'asc' },
    });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const branches = await Promise.all(branchRows.map(async (branch) => {
      const psId = branch.pawnshopId || scopedPawnshopId;
      const staffCount = await this.prisma.staff.count({ where: { branchId: branch.id } }).catch(() => 0);
      const activeTickets = await this.prisma.ticket.count({ where: { branchId: branch.id, pawnshopId: psId, status: 'ACTIVE' } });
      const redeemedTickets = await this.prisma.ticket.count({ where: { branchId: branch.id, pawnshopId: psId, status: 'REDEEMED' } });
      const atRiskTickets = await this.prisma.ticket.count({ where: { branchId: branch.id, pawnshopId: psId, status: 'ACTIVE', expiryDate: { lt: now } } });
      const activeLoanAgg = await this.prisma.ticket.aggregate({ where: { branchId: branch.id, pawnshopId: psId, status: 'ACTIVE' }, _sum: { loanAmount: true } });
      const redeemedLast30d = await this.prisma.ticket.count({ where: { branchId: branch.id, pawnshopId: psId, status: 'REDEEMED', updatedAt: { gte: thirtyDaysAgo } } });

      const totalTickets = activeTickets + redeemedTickets;
      let performanceScore = 50;
      let performanceStatus = 'STABLE';
      if (totalTickets > 0) {
        const redeemedRate = (redeemedTickets / totalTickets) * 100;
        performanceScore = Math.max(0, Math.min(100, redeemedRate - atRiskTickets * 10));
        if (atRiskTickets >= 3) performanceStatus = 'AT_RISK';
        else if (redeemedLast30d >= 5) performanceStatus = 'PERFORMING';
        else performanceStatus = 'STABLE';
      }

      const adminProfile = await this.prisma.profile.findFirst({
        where: { pawnshopId: psId, role: 'ADMIN', branchId: String(branch.id) },
        orderBy: { createdAt: 'desc' },
        select: { fullName: true },
      });

      return {
        id: branch.id,
        name: branch.name,
        location: branch.location,
        pawnshop_id: psId,
        owner_user_id: branch.ownerUserId,
        is_active: true,
        manager_name: adminProfile?.fullName || null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        staff_count: staffCount,
        active_tickets: activeTickets,
        redeemed_tickets: redeemedTickets,
        at_risk_tickets: atRiskTickets,
        active_loan_value: activeLoanAgg._sum.loanAmount ?? 0,
        redeemed_last_30d: redeemedLast30d,
        performance_score: Math.round(performanceScore),
        performance_status: performanceStatus,
      };
    }));

    const maxBranches = await this.resolveBranchLimit(scopedPawnshopId);
    const activeBranches = branches.length + 1;

    return {
      pawnshopId: scopedPawnshopId,
      limit: {
        maxBranches,
        activeBranches,
        remaining:
          maxBranches === null ? null : Math.max(0, maxBranches - activeBranches),
      },
      branches,
    };
  }

  async createBranch(
    actorUserId: string,
    dto: CreateBranchDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['OWNER']);

    if (!actor.pawnshopId || actor.pawnshopId !== dto.pawnshopId) {
      throw new ForbiddenException('Branch creation is restricted to your own pawnshop');
    }

    const maxBranches = await this.resolveBranchLimit(dto.pawnshopId);

    const currentCountRows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM public.branch
      WHERE pawnshop_id = ${dto.pawnshopId}::uuid
        AND COALESCE(is_active, true) = true
    `;
    const additionalActiveCount = currentCountRows[0]?.count ?? 0;
    const activeCount = additionalActiveCount + 1;

    if (maxBranches !== null && activeCount >= maxBranches) {
      throw new BadRequestException(
        `Branch limit reached for your subscription (${activeCount}/${maxBranches})`,
      );
    }

    const duplicateRows = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM public.branch
      WHERE pawnshop_id = ${dto.pawnshopId}::uuid
        AND lower(name) = lower(${dto.name})
        AND COALESCE(is_active, true) = true
      LIMIT 1
    `;
    if (duplicateRows.length > 0) {
      throw new BadRequestException('An active branch with this name already exists');
    }

    const createdRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.branch
      (name, location, pawnshop_id, owner_user_id, manager_name, is_active, created_at, updated_at)
      VALUES
      (
        ${dto.name},
        ${dto.location},
        ${dto.pawnshopId}::uuid,
        ${actor.id}::uuid,
        ${dto.managerName ?? null},
        true,
        NOW(),
        NOW()
      )
      RETURNING id, name, location, pawnshop_id, owner_user_id, manager_name, is_active, created_at, updated_at
    `;

    await this.logAudit({
      pawnshopId: dto.pawnshopId,
      actorUserId,
      action: 'BRANCH_CREATED',
      metadata: {
        branchId: createdRows[0]?.id,
        branchName: dto.name,
      },
    });

    return {
      success: true,
      branch: createdRows[0],
      message: 'Branch created successfully.',
    };
  }

  async updateBranch(
    actorUserId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ): Promise<Record<string, unknown>> {
    const actor = await this.getProfileOrThrow(actorUserId);
    this.assertRole(actor, ['OWNER']);

    if (!actor.pawnshopId) {
      throw new ForbiddenException('Your account is not linked to a pawnshop');
    }

    const parsedBranchId = this.parseBranchId(branchId);

    const branchRows = await this.prisma.$queryRaw<Array<{
      id: number;
      pawnshop_id: string;
      owner_user_id: string | null;
      name: string;
      is_active: boolean;
    }>>`
      SELECT id, pawnshop_id, owner_user_id, name, COALESCE(is_active, true) AS is_active
      FROM public.branch
      WHERE id = ${parsedBranchId}
      LIMIT 1
    `;

    const current = branchRows[0];
    if (!current) {
      throw new NotFoundException('Branch not found');
    }

    if (current.pawnshop_id !== actor.pawnshopId) {
      throw new ForbiddenException('You can only update branches in your own pawnshop');
    }

    if (current.owner_user_id && current.owner_user_id !== actor.id) {
      throw new ForbiddenException('You can only update branches that are linked to your owner account');
    }

    if (dto.name && dto.name.trim().length > 0) {
      const duplicateRows = await this.prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM public.branch
        WHERE pawnshop_id = ${actor.pawnshopId}::uuid
          AND lower(name) = lower(${dto.name})
          AND id <> ${parsedBranchId}
          AND COALESCE(is_active, true) = true
        LIMIT 1
      `;

      if (duplicateRows.length > 0) {
        throw new BadRequestException('Another active branch already uses this name');
      }
    }

    if (dto.isActive === true && current.is_active === false) {
      const maxBranches = await this.resolveBranchLimit(actor.pawnshopId);
      const countRows = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM public.branch
        WHERE pawnshop_id = ${actor.pawnshopId}::uuid
          AND COALESCE(is_active, true) = true
      `;
      const additionalActiveCount = countRows[0]?.count ?? 0;
      const activeCount = additionalActiveCount + 1;

      if (maxBranches !== null && activeCount >= maxBranches) {
        throw new BadRequestException(
          `Cannot reactivate branch. Subscription limit reached (${activeCount}/${maxBranches}).`,
        );
      }
    }

    const updatedRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      UPDATE public.branch
      SET
        name = COALESCE(${dto.name ?? null}, name),
        location = COALESCE(${dto.location ?? null}, location),
        owner_user_id = COALESCE(owner_user_id, ${actor.id}::uuid),
        manager_name = COALESCE(${dto.managerName ?? null}, manager_name),
        is_active = COALESCE(${dto.isActive ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${parsedBranchId}
      RETURNING id, name, location, pawnshop_id, owner_user_id, manager_name, is_active, created_at, updated_at
    `;

    await this.logAudit({
      pawnshopId: actor.pawnshopId,
      actorUserId,
      action: 'BRANCH_UPDATED',
      metadata: {
        branchId: parsedBranchId,
        updates: {
          name: dto.name,
          location: dto.location,
          managerName: dto.managerName,
          isActive: dto.isActive,
        },
      },
    });

    return {
      success: true,
      branch: updatedRows[0],
      message: 'Branch updated successfully.',
    };
  }

  async listSupportConversations(
    actorUserId: string,
    pawnshopId?: string,
    pawnshopName?: string,
  ): Promise<Record<string, unknown>> {
    await this.ensureSupportChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    let scopedPawnshopId: string | null = null;
    if (role === 'SUPER_ADMIN') {
      // Super admin sees all support tickets by default; optional filter by pawnshop.
      scopedPawnshopId = pawnshopId ?? null;
    } else {
      this.assertRole(actor, ['OWNER', 'ADMIN']);
      if (!actor.pawnshopId) {
        throw new BadRequestException('Your profile is not linked to a pawnshop');
      }
      scopedPawnshopId = actor.pawnshopId;
    }

    const nameFilter = pawnshopName?.trim() || null;

    const conversations = scopedPawnshopId
      ? await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
          SELECT
            c.id,
            c.pawnshop_id,
            c.subject,
            c.status,
            c.created_by,
            c.created_at,
            c.updated_at,
            c.last_message_at,
            p.name AS pawnshop_name,
            (
              SELECT m.message
              FROM public.support_chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message
          FROM public.support_chat_conversations c
          LEFT JOIN public.pawnshops p ON p.id = c.pawnshop_id
          WHERE c.pawnshop_id = ${scopedPawnshopId}::uuid
          ORDER BY c.last_message_at DESC, c.created_at DESC
          LIMIT 200
        `
      : await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
          SELECT
            c.id,
            c.pawnshop_id,
            c.subject,
            c.status,
            c.created_by,
            c.created_at,
            c.updated_at,
            c.last_message_at,
            p.name AS pawnshop_name,
            (
              SELECT m.message
              FROM public.support_chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message
          FROM public.support_chat_conversations c
          LEFT JOIN public.pawnshops p ON p.id = c.pawnshop_id
          WHERE (${nameFilter}::text IS NULL OR p.name ILIKE '%' || ${nameFilter} || '%')
          ORDER BY c.last_message_at DESC, c.created_at DESC
          LIMIT 200
        `;

    return {
      conversations,
    };
  }

  async createSupportConversation(
    actorUserId: string,
    dto: CreateSupportConversationDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureSupportChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    let pawnshopId: string | null = null;
    let senderRole: 'TENANT' | 'PLATFORM' = 'TENANT';

    if (role === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'SUPER_ADMIN cannot create inquiry tickets. Super admin may only respond to tenant-created tickets.',
      );
    } else {
      this.assertRole(actor, ['OWNER', 'ADMIN']);
      if (!actor.pawnshopId) {
        throw new BadRequestException('Your profile is not linked to a pawnshop');
      }
      pawnshopId = actor.pawnshopId;
      senderRole = 'TENANT';
    }

    const conversationId = randomUUID();

    const conversationRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.support_chat_conversations
      (id, pawnshop_id, subject, status, created_by, created_at, updated_at, last_message_at)
      VALUES
      (
        ${conversationId}::uuid,
        ${pawnshopId}::uuid,
        ${dto.subject},
        'OPEN',
        ${actorUserId}::uuid,
        NOW(),
        NOW(),
        NOW()
      )
      RETURNING id, pawnshop_id, subject, status, created_by, created_at, updated_at, last_message_at
    `;

    const messageId = randomUUID();

    const messageRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.support_chat_messages
      (id, conversation_id, pawnshop_id, sender_id, sender_role, message, created_at)
      VALUES
      (
        ${messageId}::uuid,
        ${conversationId}::uuid,
        ${pawnshopId}::uuid,
        ${actorUserId}::uuid,
        ${senderRole},
        ${dto.initialMessage},
        NOW()
      )
      RETURNING id, conversation_id, pawnshop_id, sender_id, sender_role, message, created_at
    `;

    await this.logAudit({
      pawnshopId,
      actorUserId,
      action: 'SUPPORT_CHAT_CONVERSATION_CREATED',
      metadata: {
        conversationId,
        senderRole,
        subject: dto.subject,
      },
    });

    return {
      success: true,
      conversation: conversationRows[0],
      message: messageRows[0],
    };
  }

  async listSupportMessages(
    actorUserId: string,
    conversationId: string,
  ): Promise<Record<string, unknown>> {
    await this.ensureSupportChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    const conversationRows = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_id: string;
      subject: string;
      status: string;
    }>>`
      SELECT id, pawnshop_id, subject, status
      FROM public.support_chat_conversations
      WHERE id = ${conversationId}::uuid
      LIMIT 1
    `;

    const conversation = conversationRows[0];
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (role !== 'SUPER_ADMIN') {
      this.assertRole(actor, ['OWNER', 'ADMIN']);
    }

    if (role !== 'SUPER_ADMIN' && actor.pawnshopId !== conversation.pawnshop_id) {
      throw new ForbiddenException('You can only access conversations for your pawnshop');
    }

    const messages = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      SELECT id, conversation_id, pawnshop_id, sender_id, sender_role, message, created_at
      FROM public.support_chat_messages
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
      LIMIT 500
    `;

    return {
      conversation,
      messages,
    };
  }

  async postSupportMessage(
    actorUserId: string,
    conversationId: string,
    dto: PostSupportMessageDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureSupportChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    const conversationRows = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_id: string;
      status: string;
    }>>`
      SELECT id, pawnshop_id, status
      FROM public.support_chat_conversations
      WHERE id = ${conversationId}::uuid
      LIMIT 1
    `;

    const conversation = conversationRows[0];
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (role !== 'SUPER_ADMIN') {
      this.assertRole(actor, ['OWNER', 'ADMIN']);
    }

    if (role !== 'SUPER_ADMIN' && actor.pawnshopId !== conversation.pawnshop_id) {
      throw new ForbiddenException('You can only post messages in your pawnshop conversations');
    }

    const senderRole: 'TENANT' | 'PLATFORM' =
      role === 'SUPER_ADMIN' ? 'PLATFORM' : 'TENANT';

    const messageId = randomUUID();

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      INSERT INTO public.support_chat_messages
      (id, conversation_id, pawnshop_id, sender_id, sender_role, message, created_at)
      VALUES
      (
        ${messageId}::uuid,
        ${conversationId}::uuid,
        ${conversation.pawnshop_id}::uuid,
        ${actorUserId}::uuid,
        ${senderRole},
        ${dto.message},
        NOW()
      )
      RETURNING id, conversation_id, pawnshop_id, sender_id, sender_role, message, created_at
    `;

    await this.prisma.$executeRaw`
      UPDATE public.support_chat_conversations
      SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = ${conversationId}::uuid
    `;

    return {
      success: true,
      message: rows[0],
    };
  }

  async updateSupportConversationStatus(
    actorUserId: string,
    conversationId: string,
    dto: UpdateSupportConversationStatusDto,
  ): Promise<Record<string, unknown>> {
    await this.ensureSupportChatTables();

    const actor = await this.getProfileOrThrow(actorUserId);
    const role = this.normalizeRole(actor.role);

    const conversationRows = await this.prisma.$queryRaw<Array<{
      id: string;
      pawnshop_id: string;
      status: string;
    }>>`
      SELECT id, pawnshop_id, status
      FROM public.support_chat_conversations
      WHERE id = ${conversationId}::uuid
      LIMIT 1
    `;

    const conversation = conversationRows[0];
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (role !== 'SUPER_ADMIN') {
      this.assertRole(actor, ['OWNER', 'ADMIN']);
      if (actor.pawnshopId !== conversation.pawnshop_id) {
        throw new ForbiddenException('You can only update conversation status for your pawnshop');
      }
    }

    const updatedRows = await this.prisma.$queryRaw<Array<Record<string, unknown>> >`
      UPDATE public.support_chat_conversations
      SET
        status = ${dto.status},
        updated_at = NOW()
      WHERE id = ${conversationId}::uuid
      RETURNING id, pawnshop_id, subject, status, created_by, created_at, updated_at, last_message_at
    `;

    await this.logAudit({
      pawnshopId: conversation.pawnshop_id,
      actorUserId,
      action: 'SUPPORT_CHAT_STATUS_UPDATED',
      metadata: {
        conversationId,
        status: dto.status,
      },
    });

    return {
      success: true,
      conversation: updatedRows[0],
    };
  }
}
