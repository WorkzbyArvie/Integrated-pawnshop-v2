import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';
import 'dart:async';
import 'package:pawn_shop/app_theme.dart';
import 'package:pawn_shop/core/services/backend_api_service.dart';
import 'package:pawn_shop/core/extensions/extensions.dart';
import 'package:pawn_shop/features/auth/presentation/bloc/auth_bloc.dart';
import 'package:pawn_shop/features/auth/presentation/bloc/auth_event.dart';
import 'package:pawn_shop/features/auth/presentation/bloc/auth_state.dart';

class SignupPage extends StatefulWidget {
  const SignupPage({super.key});

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> {
  late TextEditingController _emailController;
  late TextEditingController _passwordController;
  late TextEditingController _confirmPasswordController;
  late TextEditingController _authCodeController;
  late TextEditingController _firstNameController;
  late TextEditingController _lastNameController;
  late TextEditingController _phoneController;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _isLoading = false;
  bool _isRequestingCode = false;
  static const int _authCodeCooldownSeconds = 60;
  int _authCodeCooldownRemaining = 0;
  Timer? _authCodeCooldownTimer;
  String? _otpRequestedEmail;
  Map<String, bool> _passwordRequirements = {
    'length': false,
    'hasUppercase': false,
    'hasLowercase': false,
    'hasNumber': false,
  };

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController();
    _passwordController = TextEditingController();
    _confirmPasswordController = TextEditingController();
    _authCodeController = TextEditingController();
    _firstNameController = TextEditingController();
    _lastNameController = TextEditingController();
    _phoneController = TextEditingController();

    _passwordController.addListener(_updatePasswordRequirements);
    _emailController.addListener(_handleEmailChanged);
  }

  void _handleEmailChanged() {
    final currentEmail = _emailController.text.trim().toLowerCase();
    final requestedEmail = _otpRequestedEmail?.trim().toLowerCase();
    if (requestedEmail == null || requestedEmail.isEmpty) {
      return;
    }

    if (currentEmail != requestedEmail && _authCodeController.text.isNotEmpty) {
      _authCodeController.clear();
    }
  }

  void _updatePasswordRequirements() {
    setState(() {
      _passwordRequirements = _passwordController.text.validatePassword();
    });
  }

  String _friendlyBackendError(Object error) {
    if (error is DioException) {
      final data = error.response?.data;
      if (data is Map<String, dynamic>) {
        final message = data['message'] ?? data['error'];
        if (message is String && message.trim().isNotEmpty) {
          return message.trim();
        }
      }

      if (error.message != null && error.message!.trim().isNotEmpty) {
        return error.message!.trim();
      }
    }

    return error.toString().replaceFirst('Exception: ', '').trim();
  }

  Widget _buildPasswordRequirement(String label, bool isMet) {
    return Row(
      children: [
        Icon(
          isMet ? Icons.check_circle : Icons.radio_button_unchecked,
          color: isMet ? AppTheme.gold : Colors.white38,
          size: 16,
        ),
        const SizedBox(width: 8),
        Text(
          label,
          style: TextStyle(
            color: isMet ? Colors.white70 : Colors.white38,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _authCodeCooldownTimer?.cancel();
    _emailController.removeListener(_handleEmailChanged);
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _authCodeController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _startAuthCodeCooldown() {
    _authCodeCooldownTimer?.cancel();
    setState(() {
      _authCodeCooldownRemaining = _authCodeCooldownSeconds;
    });

    _authCodeCooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }

      if (_authCodeCooldownRemaining <= 1) {
        timer.cancel();
        setState(() {
          _authCodeCooldownRemaining = 0;
        });
        return;
      }

      setState(() {
        _authCodeCooldownRemaining -= 1;
      });
    });
  }

  Future<void> _requestAuthCode() async {
    if (_authCodeCooldownRemaining > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Please wait $_authCodeCooldownRemaining seconds before requesting again.',
          ),
        ),
      );
      return;
    }

    final email = _emailController.text.trim().toLowerCase();
    if (email.isEmpty || !email.isValidEmail()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid email first')),
      );
      return;
    }

    setState(() => _isRequestingCode = true);

    try {
      final raw = await BackendApiService().post(
        '/auth/request-auth-code',
        data: {
          'email': email,
          'purpose': 'BIDDER_REGISTRATION',
        },
        timeout: const Duration(seconds: 120),
        retryOnFailure: false,
      );

      final Map<String, dynamic> response =
          (raw is Map<String, dynamic> && raw['data'] is Map)
          ? Map<String, dynamic>.from(raw['data'] as Map)
          : (raw is Map<String, dynamic>)
          ? raw
          : <String, dynamic>{};

      if (!mounted) return;

      final authCode = response['authCode']?.toString();
      if (authCode != null && authCode.trim().isNotEmpty) {
        _authCodeController.text = authCode.trim();
      }

      _otpRequestedEmail = email;
      _startAuthCodeCooldown();

      final warning = response['warning']?.toString();
      final message = response['message']?.toString();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            warning != null && warning.trim().isNotEmpty
                ? warning.trim()
                : message != null && message.trim().isNotEmpty
                ? message.trim()
                : 'Authentication code sent. Check your email and continue signup.',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_friendlyBackendError(e).isNotEmpty
              ? _friendlyBackendError(e)
              : 'Network error during auth code request'),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isRequestingCode = false);
      }
    }
  }

  void _handleSignup() {
    final email = _emailController.text.trim().toLowerCase();
    final password = _passwordController.text;
    final confirmPassword = _confirmPasswordController.text;
    final authCode = _authCodeController.text.trim();
    final firstName = _firstNameController.text.trim();
    final lastName = _lastNameController.text.trim();
    final phone = _phoneController.text.trim();

    if (email.isEmpty ||
        password.isEmpty ||
        confirmPassword.isEmpty ||
        authCode.isEmpty ||
        firstName.isEmpty ||
        lastName.isEmpty ||
        phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please fill in all fields')),
      );
      return;
    }

    if (password != confirmPassword) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Passwords do not match')),
      );
      return;
    }

    if (!password.isValidPassword()) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(password.getPasswordErrorMessage())),
      );
      return;
    }

    if (phone.length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Phone number must be at least 10 digits'),
        ),
      );
      return;
    }

    if (_otpRequestedEmail == null || _otpRequestedEmail!.trim().toLowerCase() != email) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Request a verification code for this email first'),
        ),
      );
      return;
    }

    setState(() => _isLoading = true);

    context.read<AuthBloc>().add(
          SignupEvent(
            email: email,
            password: password,
            firstName: firstName,
            lastName: lastName,
            phoneNumber: phone,
            authCode: authCode,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      body: BlocListener<AuthBloc, AuthState>(
        listener: (context, state) {
          if (!mounted) return;

          if (state is AuthLoading) {
            setState(() => _isLoading = true);
          } else if (state is AuthAuthenticated) {
            setState(() => _isLoading = false);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Account created successfully!')),
            );
            Navigator.of(context).pop();
          } else if (state is AuthError) {
            setState(() => _isLoading = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.message)),
            );
          }
        },
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
            child: Container(
              decoration: AppTheme.cardDecoration,
              padding: const EdgeInsets.all(20),
              child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 40),
                Text(
                  'Create Account',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Colors.white,
                      ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Join our pawn shop network',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.white54,
                      ),
                ),
                const SizedBox(height: 40),

                TextField(
                  controller: _firstNameController,
                  keyboardType: TextInputType.name,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('First Name').copyWith(
                    prefixIcon: const Icon(
                      Icons.person_outline,
                      color: Colors.white54,
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                TextField(
                  controller: _lastNameController,
                  keyboardType: TextInputType.name,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('Last Name').copyWith(
                    prefixIcon: const Icon(
                      Icons.person_outline,
                      color: Colors.white54,
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('Email Address').copyWith(
                    prefixIcon: const Icon(
                      Icons.email_outlined,
                      color: Colors.white54,
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('Philippines Phone Number').copyWith(
                    prefixIcon: const Icon(
                      Icons.phone_outlined,
                      color: Colors.white54,
                    ),
                    helperText: 'e.g., 09123456789 or +63912345678',
                    helperStyle: const TextStyle(color: Colors.white38),
                  ),
                ),
                const SizedBox(height: 16),

                TextField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('Password').copyWith(
                    prefixIcon: const Icon(
                      Icons.lock_outlined,
                      color: Colors.white54,
                    ),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscurePassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        color: Colors.white54,
                      ),
                      onPressed: () {
                        setState(
                          () => _obscurePassword = !_obscurePassword,
                        );
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                if (_passwordController.text.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceElevated,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.08),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Password Requirements:',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Colors.white54,
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 8),
                        _buildPasswordRequirement(
                          'At least 8 characters',
                          _passwordRequirements['length']!,
                        ),
                        const SizedBox(height: 6),
                        _buildPasswordRequirement(
                          'At least one uppercase letter (A-Z)',
                          _passwordRequirements['hasUppercase']!,
                        ),
                        const SizedBox(height: 6),
                        _buildPasswordRequirement(
                          'At least one lowercase letter (a-z)',
                          _passwordRequirements['hasLowercase']!,
                        ),
                        const SizedBox(height: 6),
                        _buildPasswordRequirement(
                          'At least one number (0-9)',
                          _passwordRequirements['hasNumber']!,
                        ),
                      ],
                    ),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: Text(
                      'Password must be 8+ characters with uppercase, lowercase, and number',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Colors.white38,
                          ),
                    ),
                  ),
                const SizedBox(height: 16),

                TextField(
                  controller: _confirmPasswordController,
                  obscureText: _obscureConfirmPassword,
                  style: const TextStyle(color: Colors.white),
                  decoration: AppTheme.inputDecoration('Confirm Password').copyWith(
                    prefixIcon: const Icon(
                      Icons.lock_outlined,
                      color: Colors.white54,
                    ),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureConfirmPassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        color: Colors.white54,
                      ),
                      onPressed: () {
                        setState(
                          () => _obscureConfirmPassword =
                              !_obscureConfirmPassword,
                        );
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _authCodeController,
                        keyboardType: TextInputType.number,
                        style: const TextStyle(color: Colors.white),
                        decoration: AppTheme.inputDecoration('Authentication Code').copyWith(
                          prefixIcon: const Icon(
                            Icons.verified_user_outlined,
                            color: Colors.white54,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: (_isLoading || _isRequestingCode || _authCodeCooldownRemaining > 0)
                          ? null
                          : _requestAuthCode,
                      child: _isRequestingCode
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(
                              _authCodeCooldownRemaining > 0
                                  ? 'Resend in ${_authCodeCooldownRemaining}s'
                                  : 'Request Code',
                            ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      'Didnt recieve code? ',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Colors.white54,
                          ),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: (_isLoading || _isRequestingCode || _authCodeCooldownRemaining > 0)
                          ? null
                          : _requestAuthCode,
                      child: Text(
                        _authCodeCooldownRemaining > 0
                            ? 'Resend code again in ${_authCodeCooldownRemaining}s'
                            : 'Resend code again',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    onPressed: _isLoading ? null : _handleSignup,
                    child: _isLoading
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation(Colors.black),
                            ),
                          )
                        : Text(
                            'Create Account',
                            style: Theme.of(context)
                                .textTheme
                                .bodyLarge
                                ?.copyWith(
                                  color: Colors.black,
                                  fontWeight: FontWeight.bold,
                                ),
                          ),
                  ),
                ),
                const SizedBox(height: 16),

                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Already have an account? ',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Colors.white54,
                          ),
                    ),
                    GestureDetector(
                      onTap: () {
                        Navigator.of(context).pop();
                      },
                      child: Text(
                        'Sign In',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppTheme.gold,
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        ),
      ),
      );
  }
}
