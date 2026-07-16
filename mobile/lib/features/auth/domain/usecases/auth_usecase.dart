import 'package:pawn_shop/features/auth/data/models/user_model.dart';
import 'package:pawn_shop/features/auth/data/repositories/auth_repository.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';
import 'package:pawn_shop/core/extensions/extensions.dart';

/// Use case for user login
class LoginUseCase {
  final AuthRepository repository;

  LoginUseCase({required this.repository});

  Future<LoginResponseModel> call({
    required String email,
    required String password,
  }) async {
    // Validate inputs
    if (!email.isValidEmail()) {
      throw ValidationException(
        message: 'Invalid email format',
        fieldErrors: {'email': 'Email must be a valid format'},
      );
    }

    if (password.isEmpty) {
      throw ValidationException(
        message: 'Password is required',
        fieldErrors: {'password': 'Password cannot be empty'},
      );
    }

    // Call repository
    return await repository.login(
      email: email,
      password: password,
    );
  }
}

/// Use case for getting current user
class GetCurrentUserUseCase {
  final AuthRepository repository;

  GetCurrentUserUseCase({required this.repository});

  Future<UserModel?> call() async {
    return await repository.getCurrentUser();
  }
}

/// Use case for logout
class LogoutUseCase {
  final AuthRepository repository;

  LogoutUseCase({required this.repository});

  Future<void> call() async {
    return await repository.logout();
  }
}

/// Use case for checking authentication status
class CheckAuthStatusUseCase {
  final AuthRepository repository;

  CheckAuthStatusUseCase({required this.repository});

  Future<bool> call() async {
    return await repository.isAuthenticated();
  }
}

/// Use case for user signup
class SignupUseCase {
  final AuthRepository repository;

  SignupUseCase({required this.repository});

  Future<LoginResponseModel> call({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String phoneNumber,
    required String authCode,
  }) async {
    // Validate inputs
    if (!email.isValidEmail()) {
      throw ValidationException(
        message: 'Invalid email format',
        fieldErrors: {'email': 'Email must be a valid format'},
      );
    }

    if (!password.isValidPassword()) {
      throw ValidationException(
        message: password.getPasswordErrorMessage(),
        fieldErrors: {'password': password.getPasswordErrorMessage()},
      );
    }

    if (firstName.isEmpty) {
      throw ValidationException(
        message: 'First name is required',
        fieldErrors: {'firstName': 'First name cannot be empty'},
      );
    }

    if (lastName.isEmpty) {
      throw ValidationException(
        message: 'Last name is required',
        fieldErrors: {'lastName': 'Last name cannot be empty'},
      );
    }

    if (phoneNumber.isEmpty || phoneNumber.length < 10) {
      throw ValidationException(
        message: 'Invalid phone number',
        fieldErrors: {'phoneNumber': 'Phone number must be at least 10 digits'},
      );
    }

    if (authCode.trim().isEmpty) {
      throw ValidationException(
        message: 'Authentication code is required',
        fieldErrors: {'authCode': 'Authentication code cannot be empty'},
      );
    }

    // Call repository
    return await repository.signup(
      email: email,
      password: password,
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      authCode: authCode,
    );
  }
}
