import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';
import 'package:pawn_shop/core/services/secure_storage.dart';
import 'package:pawn_shop/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:pawn_shop/features/auth/data/repositories/auth_repository.dart';

class _MockAuthRemoteDataSource extends Mock implements AuthRemoteDataSource {}

class _MockSecureStorageService extends Mock implements SecureStorageService {}

void main() {
  late AuthRepositoryImpl repository;
  late _MockAuthRemoteDataSource remoteDataSource;
  late _MockSecureStorageService secureStorage;

  setUp(() {
    remoteDataSource = _MockAuthRemoteDataSource();
    secureStorage = _MockSecureStorageService();
    repository = AuthRepositoryImpl(
      remoteDataSource: remoteDataSource,
      secureStorage: secureStorage,
    );
  });

  group('AuthRepositoryImpl.logout', () {
    test('clears only auth data after successful remote logout', () async {
      when(() => remoteDataSource.logout()).thenAnswer((_) async {});
      when(() => secureStorage.clearAuthData()).thenAnswer((_) async {});

      await repository.logout();

      verify(() => remoteDataSource.logout()).called(1);
      verify(() => secureStorage.clearAuthData()).called(1);
      verifyNever(() => secureStorage.clearAll());
    });

    test('rethrows AuthException and does not clear storage on remote failure', () async {
      when(() => remoteDataSource.logout()).thenThrow(
        AuthException(message: 'logout failed', code: 'LOGOUT_ERROR'),
      );

      await expectLater(
        repository.logout(),
        throwsA(isA<AuthException>()),
      );

      verify(() => remoteDataSource.logout()).called(1);
      verifyNever(() => secureStorage.clearAuthData());
      verifyNever(() => secureStorage.clearAll());
    });
  });
}
