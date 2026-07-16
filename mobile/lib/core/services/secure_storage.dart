import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wrapper for Flutter Secure Storage
/// Handles JWT tokens and sensitive data encryption on device
class SecureStorageService {
  static const String _jwtTokenKey = 'jwt_token';
  static const String _refreshTokenKey = 'refresh_token';
  static const String _userIdKey = 'user_id';

  static final SecureStorageService _instance = SecureStorageService._internal();

  final FlutterSecureStorage _storage;

  factory SecureStorageService({FlutterSecureStorage? storage}) {
    return _instance;
  }

  SecureStorageService._internal()
      : _storage = const FlutterSecureStorage();

  /// Store JWT token securely
  Future<void> saveJwtToken(String token) async {
    await _storage.write(key: _jwtTokenKey, value: token);
  }

  /// Retrieve JWT token
  Future<String?> getJwtToken() async {
    return await _storage.read(key: _jwtTokenKey);
  }

  /// Store refresh token
  Future<void> saveRefreshToken(String token) async {
    await _storage.write(key: _refreshTokenKey, value: token);
  }

  /// Retrieve refresh token
  Future<String?> getRefreshToken() async {
    return await _storage.read(key: _refreshTokenKey);
  }

  /// Store user ID
  Future<void> saveUserId(String userId) async {
    await _storage.write(key: _userIdKey, value: userId);
  }

  /// Retrieve user ID
  Future<String?> getUserId() async {
    return await _storage.read(key: _userIdKey);
  }

  /// Store arbitrary secure data
  Future<void> save({required String key, required String value}) async {
    await _storage.write(key: key, value: value);
  }

  /// Retrieve arbitrary secure data
  Future<String?> get({required String key}) async {
    return await _storage.read(key: key);
  }

  /// Delete specific key
  Future<void> delete({required String key}) async {
    await _storage.delete(key: key);
  }

  /// Clear all stored data (logout)
  Future<void> clearAll() async {
    await _storage.deleteAll();
  }

  /// Clear only authentication data while preserving feature caches.
  Future<void> clearAuthData() async {
    await _storage.delete(key: _jwtTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userIdKey);
  }

  /// Check if a key exists
  Future<bool> contains({required String key}) async {
    final value = await _storage.read(key: key);
    return value != null;
  }
}
