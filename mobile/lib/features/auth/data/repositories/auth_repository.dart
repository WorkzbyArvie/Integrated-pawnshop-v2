import 'package:pawn_shop/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:pawn_shop/features/auth/data/models/user_model.dart';
import 'package:pawn_shop/core/services/secure_storage.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';

/// Abstract repository for authentication
abstract class AuthRepository {
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

  Future<UserModel?> getCurrentUser();
  
  Future<void> logout();
  
  Future<bool> isAuthenticated();
  
  Future<void> saveUserLocally(UserModel user);
}

/// Concrete implementation of AuthRepository
class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource remoteDataSource;
  final SecureStorageService secureStorage;

  AuthRepositoryImpl({
    required this.remoteDataSource,
    required this.secureStorage,
  });

  @override
  Future<LoginResponseModel> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await remoteDataSource.login(
        email: email,
        password: password,
      );

      // Save tokens securely
      await secureStorage.saveJwtToken(response.accessToken);
      if (response.refreshToken != null) {
        await secureStorage.saveRefreshToken(response.refreshToken!);
      }
      await secureStorage.saveUserId(response.user.id);

      return response;
    } on AuthException {
      rethrow;
    } catch (e) {
      throw AuthException(
        message: 'Authentication failed: ${e.toString()}',
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
      final response = await remoteDataSource.signup(
        email: email,
        password: password,
        firstName: firstName,
        lastName: lastName,
        phoneNumber: phoneNumber,
        authCode: authCode,
      );

      // Save tokens securely
      await secureStorage.saveJwtToken(response.accessToken);
      if (response.refreshToken != null) {
        await secureStorage.saveRefreshToken(response.refreshToken!);
      }
      await secureStorage.saveUserId(response.user.id);

      return response;
    } on AuthException {
      rethrow;
    } catch (e) {
      throw AuthException(
        message: 'Signup failed: ${e.toString()}',
        originalException: e,
      );
    }
  }

  @override
  Future<UserModel?> getCurrentUser() async {
    try {
      final userId = await secureStorage.getUserId();
      if (userId == null) {
        return null;
      }

      return await remoteDataSource.getCurrentUser(userId);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<void> logout() async {
    try {
      await remoteDataSource.logout();
      await secureStorage.clearAuthData();
    } on AuthException {
      rethrow;
    } catch (e) {
      throw AuthException(
        message: 'Logout failed: ${e.toString()}',
        originalException: e,
      );
    }
  }

  @override
  Future<bool> isAuthenticated() async {
    try {
      final token = await secureStorage.getJwtToken();
      return token != null && token.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> saveUserLocally(UserModel user) async {
    try {
      await secureStorage.saveUserId(user.id);
      // In a real app, you might save additional user data
    } catch (e) {
      throw CacheException(
        message: 'Failed to save user locally: ${e.toString()}',
        originalException: e,
      );
    }
  }
}
