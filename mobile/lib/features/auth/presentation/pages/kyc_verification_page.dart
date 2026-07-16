import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pawn_shop/app_theme.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../../core/services/backend_api_service.dart';

enum MobileKycStatus { notSubmitted, pending, verified, rejected }

class KycVerificationPage extends StatefulWidget {
  final MobileKycStatus initialStatus;
  final String? rejectionReason;
  final VoidCallback? onStatusChanged;

  const KycVerificationPage({
    super.key,
    required this.initialStatus,
    this.rejectionReason,
    this.onStatusChanged,
  });

  @override
  State<KycVerificationPage> createState() => _KycVerificationPageState();
}

class _KycVerificationPageState extends State<KycVerificationPage> {
  final _formKey = GlobalKey<FormState>();
  final _picker = ImagePicker();
  final _backendApi = BackendApiService();

  final _fullNameController = TextEditingController();
  final _dobController = TextEditingController();
  final _addressController = TextEditingController();
  final _phoneController = TextEditingController();
  final _idNumberController = TextEditingController();

  String _idType = 'NATIONAL_ID';
  XFile? _idFront;
  XFile? _idBack;
  XFile? _selfie;
  DateTime? _selfieCapturedAt;

  bool _submitting = false;
  String? _errorMessage;
  static const Duration _maxSelfieAge = Duration(minutes: 25);

  static Map<String, dynamic>? _kycDraft;

  @override
  void initState() {
    super.initState();
    _restoreDraft();
    _fullNameController.addListener(_saveDraft);
    _dobController.addListener(_saveDraft);
    _addressController.addListener(_saveDraft);
    _phoneController.addListener(_saveDraft);
    _idNumberController.addListener(_saveDraft);
  }

  void _restoreDraft() {
    final draft = _kycDraft;
    if (draft == null) return;

    _fullNameController.text = (draft['fullName'] as String?) ?? '';
    _dobController.text = (draft['dob'] as String?) ?? '';
    _addressController.text = (draft['address'] as String?) ?? '';
    _phoneController.text = (draft['phone'] as String?) ?? '';
    _idNumberController.text = (draft['idNumber'] as String?) ?? '';
    _idType = (draft['idType'] as String?) ?? _idType;

    final idFrontPath = (draft['idFrontPath'] as String?) ?? '';
    final idBackPath = (draft['idBackPath'] as String?) ?? '';
    final selfiePath = (draft['selfiePath'] as String?) ?? '';

    if (idFrontPath.isNotEmpty) _idFront = XFile(idFrontPath);
    if (idBackPath.isNotEmpty) _idBack = XFile(idBackPath);
    if (selfiePath.isNotEmpty) _selfie = XFile(selfiePath);

    final capturedAt = (draft['selfieCapturedAt'] as String?) ?? '';
    if (capturedAt.isNotEmpty) {
      _selfieCapturedAt = DateTime.tryParse(capturedAt);
    }

    _invalidateStaleSelfie(showMessage: false);
  }

  void _saveDraft() {
    _kycDraft = {
      'fullName': _fullNameController.text,
      'dob': _dobController.text,
      'address': _addressController.text,
      'phone': _phoneController.text,
      'idNumber': _idNumberController.text,
      'idType': _idType,
      'idFrontPath': _idFront?.path,
      'idBackPath': _idBack?.path,
      'selfiePath': _selfie?.path,
      'selfieCapturedAt': _selfieCapturedAt?.toUtc().toIso8601String(),
    };
  }

  void _clearDraft() {
    _kycDraft = null;
  }

  bool _isSelfieExpired(DateTime capturedAt) {
    return DateTime.now().toUtc().difference(capturedAt.toUtc()) > _maxSelfieAge;
  }

  bool _invalidateStaleSelfie({required bool showMessage}) {
    final capturedAt = _selfieCapturedAt;
    if (capturedAt == null) return false;
    if (!_isSelfieExpired(capturedAt)) return false;

    _selfie = null;
    _selfieCapturedAt = null;
    _saveDraft();
    if (showMessage) {
      _errorMessage =
          'Your live selfie has expired. Please capture a new selfie before submitting.';
    }
    return true;
  }

  String? _validateFullName(String? value) {
    final name = (value ?? '').trim().replaceAll(RegExp(r'\s+'), ' ');
    if (name.isEmpty) return 'Required';
    if (name.length < 2 || name.length > 100) {
      return 'Name must be 2-100 characters';
    }
    if (!RegExp(r"^[A-Za-z][A-Za-z .,'-]*$").hasMatch(name)) {
      return 'Use letters and basic punctuation only';
    }
    if (name.split(' ').where((p) => p.trim().isNotEmpty).length < 2) {
      return 'Enter full legal name';
    }
    return null;
  }

  String? _validateDob(String? value) {
    final dob = (value ?? '').trim();
    if (dob.isEmpty) return 'Required';
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dob)) {
      return 'Use YYYY-MM-DD format';
    }

    final parsed = DateTime.tryParse(dob);
    if (parsed == null || parsed.toIso8601String().substring(0, 10) != dob) {
      return 'Invalid birth date';
    }

    final now = DateTime.now();
    var age = now.year - parsed.year;
    if (now.month < parsed.month ||
        (now.month == parsed.month && now.day < parsed.day)) {
      age -= 1;
    }

    if (age < 18) return 'Must be at least 18 years old';
    if (age > 100) return 'Please enter a valid birth date';
    return null;
  }

  String? _validatePhone(String? value) {
    final input = (value ?? '').trim();
    if (input.isEmpty) return 'Required';
    final digitsOnly = input.replaceAll(RegExp(r'\D+'), '');
    final isLocal = RegExp(r'^09\d{9}$').hasMatch(digitsOnly);
    final isIntlNoPlus = RegExp(r'^639\d{9}$').hasMatch(digitsOnly);
    final isIntl = RegExp(r'^\+639\d{9}$').hasMatch(input);
    if (!isLocal && !isIntlNoPlus && !isIntl) {
      return 'Enter a valid PH mobile number';
    }
    return null;
  }

  String? _validateIdNumber(String? value) {
    final id = (value ?? '').trim().toUpperCase();
    if (id.isEmpty) return 'Required';
    if (!RegExp(r'^[A-Z0-9-]{6,32}$').hasMatch(id.replaceAll(' ', ''))) {
      return 'Invalid ID number format';
    }

    final compare = id.replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (_idType == 'NATIONAL_ID' && !RegExp(r'^\d{12}$').hasMatch(compare)) {
      return 'National ID must be 12 digits';
    }
    return null;
  }

  @override
  void dispose() {
    _fullNameController.removeListener(_saveDraft);
    _dobController.removeListener(_saveDraft);
    _addressController.removeListener(_saveDraft);
    _phoneController.removeListener(_saveDraft);
    _idNumberController.removeListener(_saveDraft);
    _fullNameController.dispose();
    _dobController.dispose();
    _addressController.dispose();
    _phoneController.dispose();
    _idNumberController.dispose();
    super.dispose();
  }

  Future<void> _pickImage({
    required bool fromCamera,
    required void Function(XFile) onPicked,
  }) async {
    final image = await _picker.pickImage(
      source: fromCamera ? ImageSource.camera : ImageSource.gallery,
      imageQuality: 90,
      maxWidth: 1920,
    );

    if (image != null) {
      onPicked(image);
      _saveDraft();
      setState(() {});
    }
  }

  Future<String> _uploadToSupabase(
    XFile file,
    String folder,
    String userId,
  ) async {
    final supabase = Supabase.instance.client;
    final rawName = file.name.trim();
    final hasExt =
        rawName.contains('.') && rawName.split('.').last.trim().isNotEmpty;
    final ext = hasExt ? rawName.split('.').last.toLowerCase() : 'jpg';
    final safeExt = ext.replaceAll(RegExp(r'[^a-z0-9]'), '');
    final finalExt = safeExt.isEmpty ? 'jpg' : safeExt;

    final mimeType =
        file.mimeType ??
        (finalExt == 'png'
            ? 'image/png'
            : finalExt == 'webp'
            ? 'image/webp'
            : 'image/jpeg');

    final path =
        '$folder/${userId}_${DateTime.now().millisecondsSinceEpoch}.$finalExt';

    final bytes = await file.readAsBytes();
    await supabase.storage
        .from('kyc-documents')
        .uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: mimeType, upsert: true),
        );

    return supabase.storage.from('kyc-documents').getPublicUrl(path);
  }

  Future<void> _submitKyc() async {
    final selfieWasInvalidated = _invalidateStaleSelfie(showMessage: true);
    if (selfieWasInvalidated && mounted) {
      setState(() {});
    }
    if (!_formKey.currentState!.validate()) return;
    if (_idFront == null || _selfie == null || _selfieCapturedAt == null) {
      setState(
        () =>
            _errorMessage = 'Please upload ID front and capture a live selfie.',
      );
      return;
    }

    final session = Supabase.instance.client.auth.currentSession;
    final user = Supabase.instance.client.auth.currentUser;
    if (session == null || user == null) {
      setState(() => _errorMessage = 'Session expired. Please login again.');
      return;
    }

    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      final effectiveSelfieCapturedAt = _selfieCapturedAt!;

      final idFrontUrl = await _uploadToSupabase(
        _idFront!,
        'id-front',
        user.id,
      );
      final idBackUrl = _idBack != null
          ? await _uploadToSupabase(_idBack!, 'id-back', user.id)
          : null;
      final selfieUrl = await _uploadToSupabase(_selfie!, 'selfie', user.id);

      await _backendApi.post(
        '/auth/kyc/submit',
        accessToken: session.accessToken,
        data: {
          'fullName': _fullNameController.text.trim(),
          'dateOfBirth': _dobController.text.trim(),
          'address': _addressController.text.trim(),
          'phoneNumber': _phoneController.text.trim(),
          'idType': _idType,
          'idNumber': _idNumberController.text.trim(),
          'idFrontUrl': idFrontUrl,
          'idBackUrl': idBackUrl,
          'selfieUrl': selfieUrl,
          'liveSelfieUrl': selfieUrl,
          'selfieCaptureMode': 'LIVE',
          'selfieCapturedAt': effectiveSelfieCapturedAt.toUtc().toIso8601String(),
        },
      );

      if (!mounted) return;
      _clearDraft();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('KYC submitted and verified successfully.'),
        ),
      );
      widget.onStatusChanged?.call();
    } catch (e) {
      final raw = e.toString();
      if (raw.contains('Live selfie capture is expired')) {
        setState(() {
          _errorMessage =
              'Live selfie expired. Please capture a new selfie and submit again.';
        });
      } else {
        setState(() => _errorMessage = 'Submission failed: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.initialStatus;

    if (status == MobileKycStatus.verified) {
      return _statusScaffold(
        title: 'Identity Verified',
        message: 'Your account is fully verified.',
        color: Colors.green,
      );
    }

    if (status == MobileKycStatus.pending) {
      return _statusScaffold(
        title: 'KYC Under Review',
        message: 'Your verification is pending admin approval.',
        color: Colors.amber,
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Container(
            decoration: AppTheme.cardDecoration,
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Identity Details',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Submit accurate details and a live selfie for account approval.',
                  style: TextStyle(color: AppTheme.textMuted),
                ),
                const SizedBox(height: 16),
                if (status == MobileKycStatus.rejected)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: AppTheme.danger.withValues(alpha: 0.1),
                      border: Border.all(
                        color: AppTheme.danger.withValues(alpha: 0.35),
                      ),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      widget.rejectionReason ??
                          'Previous verification was rejected. Please re-submit.',
                      style: const TextStyle(color: AppTheme.danger),
                    ),
                  ),
                TextFormField(
                  controller: _fullNameController,
                  decoration: const InputDecoration(
                    labelText: 'Full Legal Name',
                  ),
                  validator: _validateFullName,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _dobController,
                  decoration: const InputDecoration(
                    labelText: 'Date of Birth (YYYY-MM-DD)',
                  ),
                  keyboardType: TextInputType.datetime,
                  validator: _validateDob,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _addressController,
                  decoration: const InputDecoration(labelText: 'Address'),
                  validator: (v) =>
                      (v == null || v.trim().length < 10)
                      ? 'Address must be at least 10 characters'
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone Number'),
                  validator: _validatePhone,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _idType,
                  decoration: const InputDecoration(labelText: 'ID Type'),
                  items: const [
                    DropdownMenuItem(
                      value: 'NATIONAL_ID',
                      child: Text('National ID'),
                    ),
                    DropdownMenuItem(
                      value: 'PASSPORT',
                      child: Text('Passport'),
                    ),
                    DropdownMenuItem(
                      value: 'DRIVERS_LICENSE',
                      child: Text('Driver\'s License'),
                    ),
                    DropdownMenuItem(value: 'SSS_ID', child: Text('SSS ID')),
                    DropdownMenuItem(
                      value: 'PHILHEALTH_ID',
                      child: Text('PhilHealth ID'),
                    ),
                    DropdownMenuItem(value: 'TIN_ID', child: Text('TIN ID')),
                    DropdownMenuItem(
                      value: 'VOTERS_ID',
                      child: Text('Voter\'s ID'),
                    ),
                    DropdownMenuItem(
                      value: 'POSTAL_ID',
                      child: Text('Postal ID'),
                    ),
                    DropdownMenuItem(
                      value: 'OTHER',
                      child: Text('Other Government ID'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _idType = value);
                      _saveDraft();
                    }
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _idNumberController,
                  decoration: const InputDecoration(labelText: 'ID Number'),
                  validator: _validateIdNumber,
                ),
                const SizedBox(height: 16),
                const Text(
                  'ID Front *',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Row(
                  children: [
                    OutlinedButton(
                      onPressed: () => _pickImage(
                        fromCamera: false,
                        onPicked: (file) => _idFront = file,
                      ),
                      child: const Text('Upload Front'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _idFront?.name ?? 'No file selected',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text(
                  'ID Back (Optional)',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Row(
                  children: [
                    OutlinedButton(
                      onPressed: () => _pickImage(
                        fromCamera: false,
                        onPicked: (file) => _idBack = file,
                      ),
                      child: const Text('Upload Back'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _idBack?.name ?? 'No file selected',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text(
                  'Live Selfie with ID *',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Row(
                  children: [
                    ElevatedButton(
                      onPressed: () => _pickImage(
                        fromCamera: true,
                        onPicked: (file) {
                          _selfie = file;
                          _selfieCapturedAt = DateTime.now().toUtc();
                        },
                      ),
                      child: const Text('Capture Selfie'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _selfie?.name ?? 'No selfie captured',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (_errorMessage != null)
                  Text(
                    _errorMessage!,
                    style: const TextStyle(color: AppTheme.danger),
                  ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _submitting ? null : _submitKyc,
                    child: _submitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Submit Verification'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statusScaffold({
    required String title,
    required String message,
    required Color color,
  }) {
    return Scaffold(
      appBar: AppBar(title: const Text('KYC Verification')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Container(
            width: double.infinity,
            decoration: AppTheme.cardDecoration,
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.verified_user, color: color, size: 56),
                const SizedBox(height: 12),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(message, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: widget.onStatusChanged,
                  child: const Text('Refresh Status'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
