import 'package:pawn_shop/features/auth/data/models/user_model.dart';
import 'package:pawn_shop/core/services/supabase_service.dart';
import 'package:pawn_shop/core/services/backend_api_service.dart';
import 'package:pawn_shop/core/services/logger.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';
import 'package:pawn_shop/config/app_constants.dart';
import 'package:dio/dio.dart';

abstract class AuthRemoteDataSource {
  Future<LoginResponseModel> login({
    required String email,
    required String password,
  });

  Future<LoginResponseModel> signup({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String phoneNumber,
    required String authCode,
  });

  Future<UserModel> getCurrentUser(String userId);

  Future<void> logout();

  Future<UserModel> refreshUserData(String userId);
}

class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  final SupabaseService supabaseService;
  final BackendApiService backendApiService;

  AuthRemoteDataSourceImpl({
    required this.supabaseService,
    required this.backendApiService,
  });

  @override
  Future<LoginResponseModel> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await supabaseService.signIn(
        email: email,
        password: password,
      );

      if (response.user == null) {
        throw AuthException(
          message: 'Incorrect password or email',
          code: 'INVALID_CREDENTIALS',
        );
      }

      try {
        final profileData = await supabaseService.query(
          AppConstants.usersTable,
          select: 'id,email,full_name,role,pawnshop_id,branch_id,created_at,updated_at',
          filters: {'id': response.user!.id},
        );

        if (profileData.isEmpty) {
          throw AuthException(
            message: 'User profile not found',
            code: 'PROFILE_NOT_FOUND',
          );
        }

        final user = UserModel.fromJson(profileData.first);

        return LoginResponseModel(
          user: user,
          accessToken: response.session?.accessToken ?? '',
          refreshToken: response.session?.refreshToken,
        );
      } on AuthException {
        rethrow;
      } catch (e) {
        AppLogger.warning('Could not fetch profile (RLS issue): $e');

        final user = UserModel(
          id: response.user!.id,
          email: response.user!.email ?? email,
          role: (response.user!.userMetadata?['role'] as String?) ?? 'BIDDER',
          createdAt: DateTime.now(),
        );

        return LoginResponseModel(
          user: user,
          accessToken: response.session?.accessToken ?? '',
          refreshToken: response.session?.refreshToken,
        );
      }
    } catch (e) {
      final errorMsg = e.toString().toLowerCase();
      String message = 'Login failed';
      String code = 'LOGIN_ERROR';

      if (errorMsg.contains('invalid login credentials') || errorMsg.contains('invalid credentials') || errorMsg.contains('user not found')) {
        message = 'Incorrect password or email';
        code = 'INVALID_CREDENTIALS';
      } else if (errorMsg.contains('email not confirmed')) {
        message = 'Email not verified. Please check your email';
        code = 'EMAIL_NOT_CONFIRMED';
      } else if (errorMsg.contains('too many requests')) {
        message = 'Too many login attempts. Please try again later';
        code = 'RATE_LIMITED';
      }

      throw AuthException(
        message: message,
        code: code,
        originalException: e,
      );
    }
  }

  @override
  Future<LoginResponseModel> signup({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String phoneNumber,
    required String authCode,
  }) async {
    try {
      final normalizedEmail = email.trim().toLowerCase();
      final fullName = '$firstName $lastName'.trim();

      final verifyRaw = await backendApiService.post(
        '/auth/verify-auth-code',
        data: {
          'email': normalizedEmail,
          'purpose': 'BIDDER_REGISTRATION',
          'auth_code': authCode,
        },
      );

      final Map<String, dynamic> verifyResponse =
          (verifyRaw is Map<String, dynamic> && verifyRaw['data'] is Map)
          ? Map<String, dynamic>.from(verifyRaw['data'] as Map)
          : (verifyRaw is Map<String, dynamic>)
          ? verifyRaw
          : <String, dynamic>{};

      final verificationToken =
          verifyResponse['verificationToken']?.toString().trim() ??
          verifyResponse['verification_token']?.toString().trim() ??
          '';

      if (verificationToken.isEmpty) {
        throw AuthException(
          message: 'Verification code check failed. Please request a new OTP.',
          code: 'OTP_VERIFICATION_FAILED',
        );
      }

      await backendApiService.post(
        '/auth/register-bidder',
        data: {
          'email': normalizedEmail,
          'password': password,
          'full_name': fullName,
          'verification_token': verificationToken,
          'purpose': 'BIDDER_REGISTRATION',
        },
      );

      final response = await supabaseService.signIn(
        email: normalizedEmail,
        password: password,
      );

      if (response.user == null) {
        throw AuthException(
          message: 'Account creation failed',
          code: 'NO_USER_RETURNED',
        );
      }

      final now = DateTime.now().toIso8601String();
      final user = UserModel(
        id: response.user!.id,
        email: normalizedEmail,
        fullName: fullName,
        role: 'BIDDER',
        createdAt: DateTime.parse(now),
      );

      return LoginResponseModel(
        user: user,
        accessToken: response.session?.accessToken ?? '',
        refreshToken: response.session?.refreshToken,
      );
    } on AuthException {
      rethrow;
    } catch (e) {
      String message = 'Network error during registration';
      String code = 'SIGNUP_ERROR';

      if (e is DioException) {
        final data = e.response?.data;
        if (data is Map<String, dynamic>) {
          final payload = data['data'];
          final direct = data['message'] ?? data['error'];
          final nested = payload is Map<String, dynamic>
              ? payload['message'] ?? payload['error']
              : null;

          final selected = (direct is String && direct.trim().isNotEmpty)
              ? direct.trim()
              : (nested is String && nested.trim().isNotEmpty)
                  ? nested.trim()
                  : null;

          if (selected != null) {
            message = selected;
          }

          final errorMsg = message.toLowerCase();
          if (errorMsg.contains('already been registered') || errorMsg.contains('already exists')) {
            code = 'EMAIL_ALREADY_EXISTS';
          } else if (errorMsg.contains('invalid authentication code') ||
              errorMsg.contains('verification token') ||
              errorMsg.contains('authentication code has expired') ||
              errorMsg.contains('no pending authentication code')) {
            code = 'INVALID_AUTH_CODE';
          }
        } else if (e.message != null && e.message!.trim().isNotEmpty) {
          message = e.message!.trim();
        }
      } else {
        final raw = e.toString().replaceFirst('Exception: ', '').trim();
        if (raw.isNotEmpty) {
          message = raw;
        }

        final errorMsg = message.toLowerCase();
        if (errorMsg.contains('invalid email')) {
          code = 'INVALID_EMAIL';
        } else if (errorMsg.contains('password')) {
          code = 'INVALID_PASSWORD';
        }
      }

      throw AuthException(
        message: message,
        code: code,
        originalException: e,
      );
    }
  }

  @override
  Future<UserModel> getCurrentUser(String userId) async {
    try {
      try {
        final data = await supabaseService.query(
          AppConstants.usersTable,
          select: 'id,email,full_name,role,pawnshop_id,branch_id,created_at,updated_at',
          filters: {'id': userId},
        );

        if (data.isEmpty) {
          throw AuthException(
            message: 'User not found',
            code: 'USER_NOT_FOUND',
          );
        }

        return UserModel.fromJson(data.first);
      } catch (e) {
        AppLogger.warning('Could not fetch full profile: $e');

        final currentUser = supabaseService.currentUser;
        if (currentUser == null) {
          throw AuthException(
            message: 'User not authenticated',
            code: 'NOT_AUTHENTICATED',
          );
        }

        return UserModel(
          id: currentUser.id,
          email: currentUser.email ?? '',
          role: (currentUser.userMetadata?['role'] as String?) ?? 'BIDDER',
          createdAt: DateTime.now(),
        );
      }
    } on AuthException {
      rethrow;
    } catch (e) {
      final errorMsg = e.toString().toLowerCase();
      String message = 'Could not load user profile';
      String code = 'PROFILE_LOAD_ERROR';

      if (errorMsg.contains('not found')) {
        message = 'User profile not found. Please contact support';
        code = 'PROFILE_NOT_FOUND';
      } else if (errorMsg.contains('not authenticated')) {
        message = 'Not authenticated. Please login again';
        code = 'NOT_AUTHENTICATED';
      }

      throw AuthException(
        message: message,
        code: code,
        originalException: e,
      );
    }
  }

  @override
  Future<void> logout() async {
    try {
      await supabaseService.signOut();
    } catch (e) {
      throw AuthException(
        message: 'Logout failed: ${e.toString()}',
        originalException: e,
      );
    }
  }

  @override
  Future<UserModel> refreshUserData(String userId) async {
    return await getCurrentUser(userId);
  }
}
