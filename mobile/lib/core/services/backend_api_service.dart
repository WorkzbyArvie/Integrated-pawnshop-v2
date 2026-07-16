import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:pawn_shop/config/app_constants.dart';

class BackendApiService {
  static final BackendApiService _instance = BackendApiService._internal();
  static const String _fallbackBackendUrl =
      'https://pawngold-backend-production.up.railway.app';
  late final Dio _dio;
  late final int _maxRetries;
  late final Duration _retryDelay;

  factory BackendApiService() {
    return _instance;
  }

  BackendApiService._internal() {
    final configuredBaseUrl = (dotenv.env['BACKEND_URL'] ?? '').trim();
    final timeoutSeconds = int.tryParse(
          (dotenv.env['API_TIMEOUT_SECONDS'] ?? '').trim(),
        ) ??
        AppConstants.apiTimeout.inSeconds;
    final timeout = Duration(seconds: timeoutSeconds);

    _maxRetries = AppConstants.maxRetries;
    _retryDelay = AppConstants.retryDelay;

    // Respect explicit BACKEND_URL from environment, including localhost/LAN
    // values used during local development. Only fall back when unset.
    final baseUrl = configuredBaseUrl.isEmpty
        ? _fallbackBackendUrl
        : configuredBaseUrl;

    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: timeout,
        receiveTimeout: timeout,
        sendTimeout: timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      ),
    );
  }

  Options _authOptions(
    String? accessToken, {
    Map<String, String>? extraHeaders,
  }) {
    final headers = <String, String>{};

    if (accessToken == null || accessToken.isEmpty) {
      if (extraHeaders != null) {
        headers.addAll(extraHeaders);
      }
      return headers.isEmpty ? Options() : Options(headers: headers);
    }

    headers['Authorization'] = 'Bearer $accessToken';
    if (extraHeaders != null) {
      headers.addAll(extraHeaders);
    }

    return Options(headers: headers);
  }

  bool _shouldRetry(DioException error, int attempt) {
    if (attempt >= _maxRetries) {
      return false;
    }

    final statusCode = error.response?.statusCode;
    final type = error.type;

    if (type == DioExceptionType.connectionTimeout ||
        type == DioExceptionType.sendTimeout ||
        type == DioExceptionType.receiveTimeout ||
        type == DioExceptionType.connectionError) {
      return true;
    }

    if (statusCode == null) {
      return false;
    }

    return statusCode == 429 || statusCode >= 500;
  }

  Future<dynamic> _requestWithRetry(
    Future<Response<dynamic>> Function() request, {
    bool retryOnFailure = true,
  }) async {
    int attempt = 0;

    while (true) {
      try {
        final response = await request();
        return response.data;
      } on DioException catch (error) {
        if (!retryOnFailure || !_shouldRetry(error, attempt)) {
          throw Exception(_extractErrorMessage(error));
        }

        final multiplier = 1 << attempt;
        final delayMs = _retryDelay.inMilliseconds * multiplier;
        await Future<void>.delayed(Duration(milliseconds: delayMs));
        attempt += 1;
      }
    }
  }

  String _extractErrorMessage(DioException error) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Request timeout. Please check your internet and try again.';
    }

    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final direct = data['message'] ?? data['error'];
      if (direct is String && direct.trim().isNotEmpty) {
        return direct.trim();
      }

      final wrapped = data['data'];
      if (wrapped is Map<String, dynamic>) {
        final wrappedMsg = wrapped['message'] ?? wrapped['error'];
        if (wrappedMsg is String && wrappedMsg.trim().isNotEmpty) {
          return wrappedMsg.trim();
        }
      }
    }

    final status = error.response?.statusCode;
    if (status != null) {
      return 'Request failed ($status). Please try again.';
    }

    return error.message ?? 'Network request failed. Please try again.';
  }

  Future<dynamic> get(
    String path, {
    String? accessToken,
    Map<String, String>? extraHeaders,
    Duration? timeout,
    bool retryOnFailure = true,
  }) async {
    return _requestWithRetry(
      () => _dio.get(
        path,
        options: _authOptions(
          accessToken,
          extraHeaders: extraHeaders,
        ).copyWith(
          sendTimeout: timeout,
          receiveTimeout: timeout,
        ),
      ),
      retryOnFailure: retryOnFailure,
    );
  }

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? data,
    String? accessToken,
    Map<String, String>? extraHeaders,
    Duration? timeout,
    bool retryOnFailure = true,
  }) async {
    return _requestWithRetry(
      () => _dio.post(
        path,
        data: data,
        options: _authOptions(
          accessToken,
          extraHeaders: extraHeaders,
        ).copyWith(
          sendTimeout: timeout,
          receiveTimeout: timeout,
        ),
      ),
      retryOnFailure: retryOnFailure,
    );
  }

  Future<dynamic> patch(
    String path, {
    Map<String, dynamic>? data,
    String? accessToken,
    Map<String, String>? extraHeaders,
    Duration? timeout,
    bool retryOnFailure = true,
  }) async {
    return _requestWithRetry(
      () => _dio.patch(
        path,
        data: data,
        options: _authOptions(
          accessToken,
          extraHeaders: extraHeaders,
        ).copyWith(
          sendTimeout: timeout,
          receiveTimeout: timeout,
        ),
      ),
      retryOnFailure: retryOnFailure,
    );
  }

  Future<dynamic> delete(
    String path, {
    Map<String, dynamic>? data,
    String? accessToken,
    Map<String, String>? extraHeaders,
    Duration? timeout,
    bool retryOnFailure = true,
  }) async {
    return _requestWithRetry(
      () => _dio.delete(
        path,
        data: data,
        options: _authOptions(
          accessToken,
          extraHeaders: extraHeaders,
        ).copyWith(
          sendTimeout: timeout,
          receiveTimeout: timeout,
        ),
      ),
      retryOnFailure: retryOnFailure,
    );
  }
}
