import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  private resolveUserId(
    userIdHeader: string | undefined,
    authHeader: string | undefined,
  ): string {
    const userId = String(userIdHeader || '').trim();
    if (userId.length > 0) {
      return userId;
    }

    const auth = String(authHeader || '').trim();
    const [scheme, token] = auth.split(' ');
    if (scheme?.toLowerCase() != 'bearer' || !token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const tokenParts = token.split('.');
    if (tokenParts.length < 2) {
      throw new UnauthorizedException('Invalid authorization token');
    }

    try {
      const payload = JSON.parse(
        Buffer.from(tokenParts[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const subject = String(payload['sub'] || '').trim();
      if (!subject) {
        throw new UnauthorizedException('Invalid authorization token payload');
      }
      return subject;
    } catch (_) {
      throw new UnauthorizedException('Invalid authorization token payload');
    }
  }

  /**
   * Register a push token for push notifications
   * POST /notifications/register-token
   */
  @Post('register-token')
  @HttpCode(HttpStatus.CREATED)
  async registerToken(@Body() dto: RegisterPushTokenDto) {
    return this.notificationService.registerPushToken(dto);
  }

  /**
   * Deactivate a push token
   * POST /notifications/deactivate-token
   */
  @Post('deactivate-token')
  @HttpCode(HttpStatus.OK)
  async deactivateToken(@Body() body: { userId: string; deviceToken: string }) {
    await this.notificationService.deactivatePushToken(
      body.userId,
      body.deviceToken,
    );
    return { message: 'Token deactivated successfully' };
  }

  /**
   * Send a notification
   * POST /notifications/send
   */
  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  async send(@Body() dto: SendNotificationDto) {
    return this.notificationService.sendNotification(dto);
  }

  /**
   * Get user notifications
   * GET /notifications/user/:userId
   */
  @Get('user/:userId')
  async getUserNotifications(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.notificationService.getUserNotifications(userId, limit, offset);
  }

  /**
   * Mark notification as read
   * PATCH /notifications/:id/read
   */
  @Patch(':id/read')
  async markAsRead(
    @Headers('user-id') userId: string,
    @Headers('authorization') authorization: string,
    @Param('id') notificationId: string,
  ) {
    if (!notificationId?.trim()) {
      throw new BadRequestException('Notification id is required');
    }
    const actorId = this.resolveUserId(userId, authorization);
    await this.notificationService.markAsRead(actorId, notificationId);
    return { message: 'Notification marked as read' };
  }

  /**
   * Mark all notifications as read
   * PATCH /notifications/read-all
   */
  @Patch('read-all')
  async markAllAsRead(
    @Headers('user-id') userId: string,
    @Headers('authorization') authorization: string,
  ) {
    const actorId = this.resolveUserId(userId, authorization);
    const updated = await this.notificationService.markAllAsRead(actorId);
    return {
      message: 'Notifications marked as read',
      updated,
    };
  }
}
