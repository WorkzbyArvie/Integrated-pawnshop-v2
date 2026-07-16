// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:math' as math;
import 'dart:async';
import 'dart:convert';

import 'core/services/supabase_service.dart';
import 'core/services/backend_api_service.dart';
import 'core/services/secure_storage.dart';
import 'features/auth/data/datasources/auth_remote_datasource.dart';
import 'features/auth/data/repositories/auth_repository.dart';
import 'features/auth/domain/usecases/auth_usecase.dart';
import 'features/auth/presentation/bloc/auth_bloc.dart';
import 'features/auth/presentation/bloc/auth_event.dart';
import 'features/auth/presentation/bloc/auth_state.dart' as auth_state;
import 'features/auth/presentation/pages/login_page.dart';
import 'features/auth/presentation/pages/kyc_verification_page.dart';
import 'app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Suppress CanvasKit platform-view hit-test assertion errors (Flutter Web
  // CanvasKit renderer bug: mouse_tracker tries to hit-test render boxes that
  // haven't been laid out yet when platform views exist in the tree).
  final defaultOnError = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails details) {
    final msg = details.exceptionAsString();
    final isKnownCanvasKitHitTestIssue =
        msg.contains(
          'Cannot hit test a render box that has never been laid out',
        ) ||
        msg.contains('Cannot hit test a render box with no size') ||
        msg.contains('RenderBox was not laid out');

    if (isKnownCanvasKitHitTestIssue) {
      // Known non-fatal CanvasKit/platform-view issue — ignore only this class.
      return;
    }
    defaultOnError?.call(details);
  };

  // Show a visible fallback instead of an opaque black screen on build errors.
  ErrorWidget.builder = (FlutterErrorDetails details) {
    return Material(
      color: const Color(0xFF0B0C10),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline,
                color: Colors.redAccent,
                size: 42,
              ),
              const SizedBox(height: 12),
              const Text(
                'Something went wrong while loading this screen.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                details.exceptionAsString(),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
                textAlign: TextAlign.center,
                maxLines: 6,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  };

  // Load environment variables from .env file
  await dotenv.load(fileName: '.env');

  // Initialize Supabase with credentials from .env
  final supabaseUrl = dotenv.env['SUPABASE_URL'];
  final supabaseAnonKey = dotenv.env['SUPABASE_ANON_KEY'];

  if (supabaseUrl == null || supabaseAnonKey == null) {
    throw Exception(
      'Supabase credentials not found in .env file. '
      'Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set.',
    );
  }

  await Supabase.initialize(url: supabaseUrl, anonKey: supabaseAnonKey);

  runApp(const PawnShopApp());
}

class PawnShopApp extends StatelessWidget {
  const PawnShopApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Setup dependency injection for auth feature
    final supabaseService = SupabaseService();
    final backendApiService = BackendApiService();
    final secureStorage = SecureStorageService();

    final authRemoteDataSource = AuthRemoteDataSourceImpl(
      supabaseService: supabaseService,
      backendApiService: backendApiService,
    );

    final authRepository = AuthRepositoryImpl(
      remoteDataSource: authRemoteDataSource,
      secureStorage: secureStorage,
    );

    final loginUseCase = LoginUseCase(repository: authRepository);
    final signupUseCase = SignupUseCase(repository: authRepository);
    final logoutUseCase = LogoutUseCase(repository: authRepository);
    final checkAuthStatusUseCase = CheckAuthStatusUseCase(
      repository: authRepository,
    );
    final getCurrentUserUseCase = GetCurrentUserUseCase(
      repository: authRepository,
    );

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Pawn Shop',
      theme: AppTheme.theme,
      home: BlocProvider(
        create: (context) {
          final authBloc = AuthBloc(
            loginUseCase: loginUseCase,
            signupUseCase: signupUseCase,
            logoutUseCase: logoutUseCase,
            checkAuthStatusUseCase: checkAuthStatusUseCase,
            getCurrentUserUseCase: getCurrentUserUseCase,
          );
          authBloc.add(const CheckAuthStatusEvent());
          return authBloc;
        },
        child: const AppHome(),
      ),
    );
  }
}

/// App entry point that routes based on auth state
class AppHome extends StatelessWidget {
  const AppHome({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthBloc, auth_state.AuthState>(
      listener: (context, state) {
        if (state is auth_state.AuthError) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.message), backgroundColor: Colors.red),
          );
        }
      },
      child: BlocBuilder<AuthBloc, auth_state.AuthState>(
        builder: (context, state) {
          if (state is auth_state.AuthAuthenticated) {
            return const KycGate(verifiedChild: MainNavigationScreen());
          }

          // Default to login if unauthenticated
          return const LoginPage();
        },
      ),
    );
  }
}

class KycGate extends StatefulWidget {
  final Widget verifiedChild;

  const KycGate({super.key, required this.verifiedChild});

  @override
  State<KycGate> createState() => _KycGateState();
}

class _KycGateState extends State<KycGate> with WidgetsBindingObserver {
  final BackendApiService _backendApiService = BackendApiService();

  bool _loading = true;
  MobileKycStatus _status = MobileKycStatus.notSubmitted;
  String? _rejectionReason;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadKycStatus();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _loadKycStatus();
    }
  }

  Future<void> _loadKycStatus() async {
    setState(() => _loading = true);

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) {
        setState(() {
          _status = MobileKycStatus.notSubmitted;
          _loading = false;
        });
        return;
      }

      final response = await _backendApiService.get(
        '/auth/kyc/status',
        accessToken: session.accessToken,
      );

      // Backend wraps response in { success, data: { kycStatus, kyc } }
      final payload = response is Map && response.containsKey('data')
          ? response['data'] as Map<String, dynamic>
          : response as Map<String, dynamic>;

      final status = (payload['kycStatus'] as String?) ?? 'NOT_SUBMITTED';
      final kyc = payload['kyc'] as Map<String, dynamic>?;

      setState(() {
        _status = _mapKycStatus(status);
        _rejectionReason = kyc?['rejectionReason'] as String?;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _status = MobileKycStatus.notSubmitted;
        _loading = false;
      });
    }
  }

  MobileKycStatus _mapKycStatus(String status) {
    switch (status.toUpperCase()) {
      case 'VERIFIED':
        return MobileKycStatus.verified;
      case 'PENDING':
        return MobileKycStatus.verified;
      case 'REJECTED':
        return MobileKycStatus.rejected;
      default:
        return MobileKycStatus.notSubmitted;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation<Color>(AppTheme.gold),
          ),
        ),
      );
    }

    if (_status == MobileKycStatus.verified) {
      return widget.verifiedChild;
    }

    return KycVerificationPage(
      initialStatus: _status,
      rejectionReason: _rejectionReason,
      onStatusChanged: _loadKycStatus,
    );
  }
}

// --- SCREEN 1: MAIN NAVIGATION ---
class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});
  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _selectedIndex = 0;
  final List<Widget> _screens = [
    const HomeScreen(),
    const LoansScreen(),
    const AuctionScreen(),
    const AccountScreen(),
  ];

  final BackendApiService _api = BackendApiService();
  Timer? _notificationTimer;
  final Set<String> _seenNotificationIds = {};

  bool _isQueueLifecycleNotification(Map<dynamic, dynamic> notification) {
    final type = notification['type']?.toString() ?? '';
    if (type == 'QUEUE_READY') return true;
    if (type != 'SYSTEM_ANNOUNCEMENT') return false;
    final data = notification['data'];
    return data is Map && data['queueTicketId'] != null;
  }

  @override
  void initState() {
    super.initState();
    // Start polling for notifications every 10 seconds
    _pollNotifications(); // immediate first check
    _notificationTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _pollNotifications(),
    );
  }

  @override
  void dispose() {
    _notificationTimer?.cancel();
    super.dispose();
  }

  Future<void> _pollNotifications() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final userId = session.user.id;

      final raw = await _api.get(
        '/notifications/user/$userId?limit=20&offset=0',
        accessToken: session.accessToken,
      );

      // Unwrap { success, data } envelope
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List notifications = (payload is Map && payload['data'] is List)
          ? payload['data']
          : (payload is List ? payload : []);

      for (final n in notifications) {
        if (n is! Map) continue;
        final status = n['status']?.toString() ?? '';

        final id = n['id']?.toString() ?? '';
        // Show alert for queue lifecycle notifications not yet seen.
        if (_isQueueLifecycleNotification(n) &&
            status != 'READ' &&
            !_seenNotificationIds.contains(id)) {
          _seenNotificationIds.add(id);
          if (mounted) {
            final type = n['type']?.toString() ?? '';
            if (type == 'QUEUE_READY') {
              _showQueueReadyDialog(n);
            } else {
              final title = n['title']?.toString() ?? 'Queue Update';
              final body = n['body']?.toString() ?? 'Your queue status has been updated.';
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('$title: $body')),
              );
            }
            // Auto-mark as read
            _markAsRead(id, session.accessToken);
          }
        }
      }
    } catch (_) {
      // Silently ignore polling errors
    }
  }

  Future<void> _markAsRead(String notificationId, String accessToken) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      await _api.patch(
        '/notifications/$notificationId/read',
        accessToken: accessToken,
        extraHeaders: {
          if (session != null) 'user-id': session.user.id,
        },
      );
    } catch (_) {}
  }

  void _showQueueReadyDialog(Map notification) {
    final data = notification['data'];
    final queueNumber = data is Map ? data['queueNumber'] ?? '' : '';
    final counterNumber = data is Map ? data['counterNumber'] ?? '' : '';
    final title = notification['title'] ?? 'Your Turn!';
    final body = notification['body'] ?? 'Please proceed to the counter.';

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.gold.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.notifications_active,
                color: AppTheme.gold,
                size: 48,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              body,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.8),
                fontSize: 15,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            if (queueNumber.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.gold.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppTheme.gold.withValues(alpha: 0.3),
                  ),
                ),
                child: Column(
                  children: [
                    Text(
                      'Ticket #$queueNumber',
                      style: const TextStyle(
                        color: AppTheme.gold,
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (counterNumber.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'Counter: $counterNumber',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.7),
                            fontSize: 16,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
        actions: [
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.gold,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text(
                'Got it!',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tabScreens = _screens
        .map((screen) => SizedBox.expand(child: screen))
        .toList(growable: false);

    return Scaffold(
      body: SizedBox.expand(
        child: IndexedStack(index: _selectedIndex, children: tabScreens),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          border: Border(
            top: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
          ),
        ),
        child: NavigationBar(
          selectedIndex: _selectedIndex,
          indicatorColor: AppTheme.gold.withValues(alpha: 0.16),
          backgroundColor: Colors.transparent,
          labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
          onDestinationSelected: (i) => setState(() => _selectedIndex = i),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.map_outlined),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined),
              label: 'Loans',
            ),
            NavigationDestination(
              icon: Icon(Icons.gavel_rounded),
              label: 'Auction',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              label: 'Account',
            ),
          ],
        ),
      ),
    );
  }
}

// --- SCREEN 2: HOME WITH MAP & SHEET (GPS-ENABLED) ---

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final BackendApiService _backendApiService = BackendApiService();
  final SecureStorageService _secureStorage = SecureStorageService();
  final MapController _mapController = MapController();
  final TextEditingController _searchController = TextEditingController();

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _shops = [];
  String _shopSearchQuery = '';
  int _liveAuctionCount = 0;
  double? _userLat;
  double? _userLng;
  List<LatLng> _routePoints = const [];

  // Active queue tickets
  List<Map<String, dynamic>> _activeTickets = [];
  final Map<String, String> _lastTicketStatusById = <String, String>{};
  final Set<String> _emittedTicketEventKeys = <String>{};
  final List<Map<String, dynamic>> _localQueueNotifications =
      <Map<String, dynamic>>[];

  // Notifications
  List<Map<String, dynamic>> _notifications = [];
  int _unreadNotifCount = 0;
  final Set<String> _locallyReadNotificationIds = <String>{};
  final Set<String> _mutedNotificationFingerprints = <String>{};
  Timer? _ticketPollTimer;

  // Sheet tracking
  final DraggableScrollableController _sheetController =
      DraggableScrollableController();
  double _sheetExtent = 0.38;
  int? _selectedShopIndex; // which branch is selected for waypoint
  bool _routeActive = false; // is a route line shown on the map

  @override
  void initState() {
    super.initState();
    _sheetController.addListener(_onSheetChanged);
    _loadData();
    _getUserLocation();
    _loadMyTickets();
    _primeNotificationState();
    // Poll tickets & notifications every 10s
    _ticketPollTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      _loadMyTickets();
      _loadNotifications();
    });
  }

  String _readIdsStorageKey(String userId) =>
      'notification_read_ids_$userId';

  String _mutedFingerprintsStorageKey(String userId) =>
      'notification_muted_fingerprints_$userId';

  Future<void> _primeNotificationState() async {
    await _loadNotificationReadCache();
    await _loadNotifications();
  }

  Future<void> _loadNotificationReadCache() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final userId = session.user.id;

      final rawIds =
          await _secureStorage.get(key: _readIdsStorageKey(userId)) ?? '[]';
      final rawMuted =
          await _secureStorage.get(key: _mutedFingerprintsStorageKey(userId)) ??
          '[]';

      final idList = (jsonDecode(rawIds) as List)
          .map((e) => e.toString())
          .where((e) => e.isNotEmpty)
          .toSet();
      final mutedList = (jsonDecode(rawMuted) as List)
          .map((e) => e.toString())
          .where((e) => e.isNotEmpty)
          .toSet();

      if (!mounted) return;
      setState(() {
        _locallyReadNotificationIds
          ..clear()
          ..addAll(idList);
        _mutedNotificationFingerprints
          ..clear()
          ..addAll(mutedList);
      });
    } catch (_) {
      // Ignore cache parse/storage errors and continue.
    }
  }

  Future<void> _persistNotificationReadCache() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final userId = session.user.id;

      await _secureStorage.save(
        key: _readIdsStorageKey(userId),
        value: jsonEncode(_locallyReadNotificationIds.toList(growable: false)),
      );
      await _secureStorage.save(
        key: _mutedFingerprintsStorageKey(userId),
        value: jsonEncode(
          _mutedNotificationFingerprints.toList(growable: false),
        ),
      );
    } catch (_) {
      // Ignore storage errors to keep UI responsive.
    }
  }

  @override
  void dispose() {
    _ticketPollTimer?.cancel();
    _sheetController.removeListener(_onSheetChanged);
    _sheetController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadMyTickets() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final raw = await _backendApiService.get(
        '/queue/my-tickets',
        accessToken: session.accessToken,
      );
      // Unwrap { success, data } envelope
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List items = payload is List ? payload : [];

      final normalizedTickets = items
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList(growable: false);

      final generatedLocalNotifs = <Map<String, dynamic>>[];

      Map<String, dynamic> buildLocalQueueNotification({
        required String eventKey,
        required String ticketId,
        required String queueNumber,
        required String title,
        required String body,
      }) {
        return {
          'id': 'local-$eventKey',
          'type': 'SYSTEM_ANNOUNCEMENT',
          'title': title,
          'body': body,
          'status': 'UNREAD',
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'data': {
            'queueTicketId': ticketId,
            'queueNumber': queueNumber,
            'source': 'ticket_polling_fallback',
          },
        };
      }

      for (final ticket in normalizedTickets) {
        final ticketId = ticket['id']?.toString() ?? '';
        if (ticketId.isEmpty) continue;

        final queueNumber = ticket['queueNumber']?.toString() ?? '';
        final status = (ticket['status']?.toString() ?? '').toUpperCase();
        final previousStatus = _lastTicketStatusById[ticketId];

        final createEventKey = '$ticketId|CREATED';
        if (!_emittedTicketEventKeys.contains(createEventKey)) {
          _emittedTicketEventKeys.add(createEventKey);
          generatedLocalNotifs.add(
            buildLocalQueueNotification(
              eventKey: createEventKey,
              ticketId: ticketId,
              queueNumber: queueNumber,
              title: 'Queue Ticket Created',
              body:
                  'Your ticket $queueNumber was created successfully. Please wait for your turn.',
            ),
          );
        }

        if (status == 'SERVING' && previousStatus != 'SERVING') {
          final servingEventKey = '$ticketId|SERVING';
          if (!_emittedTicketEventKeys.contains(servingEventKey)) {
            _emittedTicketEventKeys.add(servingEventKey);
            generatedLocalNotifs.add(
              buildLocalQueueNotification(
                eventKey: servingEventKey,
                ticketId: ticketId,
                queueNumber: queueNumber,
                title: 'Now Serving',
                body:
                    'Ticket $queueNumber is now being served. Please proceed to the counter.',
              ),
            );
          }
        }

        if (status == 'CANCELLED' && previousStatus != 'CANCELLED') {
          final cancelledEventKey = '$ticketId|CANCELLED';
          if (!_emittedTicketEventKeys.contains(cancelledEventKey)) {
            _emittedTicketEventKeys.add(cancelledEventKey);
            generatedLocalNotifs.add(
              buildLocalQueueNotification(
                eventKey: cancelledEventKey,
                ticketId: ticketId,
                queueNumber: queueNumber,
                title: 'Ticket Cancelled',
                body: 'Ticket $queueNumber has been cancelled.',
              ),
            );
          }
        }

        _lastTicketStatusById[ticketId] = status;
      }

      if (mounted) {
        setState(() {
          _activeTickets = normalizedTickets;
          if (generatedLocalNotifs.isNotEmpty) {
            _localQueueNotifications.insertAll(0, generatedLocalNotifs);

            final existingIds = _notifications
                .map((n) => n['id']?.toString() ?? '')
                .toSet();
            final immediate = generatedLocalNotifs
                .where((n) => !existingIds.contains(n['id']?.toString() ?? ''))
                .toList(growable: false);
            if (immediate.isNotEmpty) {
              _notifications = <Map<String, dynamic>>[
                ...immediate,
                ..._notifications,
              ];
            }

            _unreadNotifCount = _notifications
                .where((n) => n['status']?.toString() != 'READ')
                .length;
          }
        });

        if (generatedLocalNotifs.isNotEmpty) {
          final latest = generatedLocalNotifs.first;
          final title = latest['title']?.toString() ?? 'Queue Update';
          final body = latest['body']?.toString() ?? 'Queue status changed.';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('$title: $body')),
          );
        }
      }
    } catch (_) {}
  }

  Future<void> _loadNotifications() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final userId = session.user.id;
      final preferredPawnshopId =
          _shops.isNotEmpty ? _shops.first['id']?.toString() : null;
      final raw = await _backendApiService.get(
        '/notifications/user/$userId?limit=20&offset=0',
        accessToken: session.accessToken,
        extraHeaders: {
          if (preferredPawnshopId != null && preferredPawnshopId.isNotEmpty)
            'pawnshop-id': preferredPawnshopId,
        },
      );
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List items = (payload is Map && payload['data'] is List)
          ? payload['data']
          : (payload is List ? payload : []);
      int unread = 0;
      final serverNotifs = <Map<String, dynamic>>[];
      for (final n in items) {
        if (n is! Map) continue;
        final m = Map<String, dynamic>.from(n);
        serverNotifs.add(m);
      }

      final mergedNotifs = <Map<String, dynamic>>[
        ..._localQueueNotifications,
        ...serverNotifs,
      ];

      mergedNotifs.sort((a, b) {
        final aTime = DateTime.tryParse(a['createdAt']?.toString() ?? '')
            ?.millisecondsSinceEpoch;
        final bTime = DateTime.tryParse(b['createdAt']?.toString() ?? '')
            ?.millisecondsSinceEpoch;
        return (bTime ?? 0).compareTo(aTime ?? 0);
      });

      final notifs = <Map<String, dynamic>>[];
      for (final m in mergedNotifs) {
        final id = m['id']?.toString() ?? '';
        final type = m['type']?.toString() ?? '';
        final title = m['title']?.toString() ?? '';
        final body = m['body']?.toString() ?? '';
        final fingerprint = '$type|$title|$body';

        // Keep notifications read in UI if user already opened them,
        // even when backend sync is delayed or inconsistent.
        if (_locallyReadNotificationIds.contains(id) ||
            _mutedNotificationFingerprints.contains(fingerprint)) {
          m['status'] = 'READ';
        }

        notifs.add(Map<String, dynamic>.from(m));
        if (m['status']?.toString() != 'READ') unread++;
      }
      if (mounted) {
        setState(() {
          _notifications = notifs;
          _unreadNotifCount = unread;
        });
      }
    } catch (_) {}
  }

  Future<void> _markNotificationAsRead(String notificationId) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;

      await _backendApiService.patch(
        '/notifications/$notificationId/read',
        accessToken: session.accessToken,
        extraHeaders: {'user-id': session.user.id},
      );
    } catch (_) {}
  }

  Future<void> _markAllNotificationsAsRead() async {
    final unreadItems = _notifications
        .where((n) => n['status']?.toString() != 'READ')
        .toList(growable: false);

    final unreadIds = unreadItems
        .where((n) => n['status']?.toString() != 'READ')
        .map((n) => n['id']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toList();

    if (unreadIds.isEmpty) return;

    if (mounted) {
      setState(() {
        _locallyReadNotificationIds.addAll(unreadIds);
        _mutedNotificationFingerprints.addAll(
          unreadItems.map((n) {
            final type = n['type']?.toString() ?? '';
            final title = n['title']?.toString() ?? '';
            final body = n['body']?.toString() ?? '';
            return '$type|$title|$body';
          }),
        );

        _notifications = _notifications
            .map((n) {
              final updated = Map<String, dynamic>.from(n);
              updated['status'] = 'READ';
              return updated;
            })
            .toList();
        _localQueueNotifications.replaceRange(
          0,
          _localQueueNotifications.length,
          _localQueueNotifications
              .map((n) {
                final updated = Map<String, dynamic>.from(n);
                updated['status'] = 'READ';
                return updated;
              })
              .toList(growable: false),
        );
        _unreadNotifCount = 0;
      });
    }

    await _persistNotificationReadCache();

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session != null) {
        await _backendApiService.patch(
          '/notifications/read-all',
          accessToken: session.accessToken,
          extraHeaders: {'user-id': session.user.id},
        );
      }
    } catch (_) {
      // Fallback to per-notification update if bulk endpoint fails.
      for (final id in unreadIds) {
        await _markNotificationAsRead(id);
      }
    }

    await _loadNotifications();
  }

  void _onSheetChanged() {
    if (!mounted) return;
    if (!_sheetController.isAttached) return;
    final newExtent = _sheetController.size;
    if ((newExtent - _sheetExtent).abs() < 0.005) return;
    // Defer setState to avoid rebuilding during the layout phase
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        setState(() {
          _sheetExtent = newExtent;
        });
      }
    });
  }

  // ── Native map helpers ───────────────────────────────────────────

  LatLng _fallbackCenter() => const LatLng(14.3294, 120.9367);

  double? _numToDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  LatLng? _shopPoint(Map<String, dynamic> shop) {
    final lat = _numToDouble(shop['latitude']);
    final lng = _numToDouble(shop['longitude']);
    if (lat == null || lng == null) return null;
    return LatLng(lat, lng);
  }

  List<LatLng> _allMapPoints() {
    final points = _shops
        .map(_shopPoint)
        .whereType<LatLng>()
        .toList(growable: true);
    if (_userLat != null && _userLng != null) {
      points.add(LatLng(_userLat!, _userLng!));
    }
    return points;
  }

  LatLng _initialCenter() {
    if (_userLat != null && _userLng != null) {
      return LatLng(_userLat!, _userLng!);
    }
    final points = _shops.map(_shopPoint).whereType<LatLng>();
    if (points.isNotEmpty) {
      return points.first;
    }
    return _fallbackCenter();
  }

  void _focusAllOnMap() {
    final points = _allMapPoints();
    if (points.isEmpty) {
      _mapController.move(_fallbackCenter(), 12);
      return;
    }

    final avgLat = points.map((p) => p.latitude).reduce((a, b) => a + b) /
        points.length;
    final avgLng = points.map((p) => p.longitude).reduce((a, b) => a + b) /
        points.length;
    _mapController.move(LatLng(avgLat, avgLng), 12);
  }

  void _focusShop(int index, {double zoom = 16}) {
    if (index < 0 || index >= _shops.length) return;
    final point = _shopPoint(_shops[index]);
    if (point == null) return;
    _mapController.move(point, zoom);
  }

  // ── GPS ──────────────────────────────────────────────────────────

  Future<bool> _getUserLocation({bool showFeedback = false}) async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (showFeedback && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location service is disabled.')),
          );
        }
        return false;
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (showFeedback && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission denied.')),
          );
        }
        return false;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );

      if (!mounted) return false;
      setState(() {
        _userLat = pos.latitude;
        _userLng = pos.longitude;

        if (_routeActive && _selectedShopIndex != null) {
          final destination = _shopPoint(_shops[_selectedShopIndex!]);
          if (destination != null) {
            _routePoints = [LatLng(_userLat!, _userLng!), destination];
          }
        }
      });
      return true;
    } catch (_) {
      if (showFeedback && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unable to get your current location.')),
        );
      }
      return false;
    }
  }

  // ── Data loading ─────────────────────────────────────────────────

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final auctionRaw = await _backendApiService.get(
        '/auction/listings?status=LIVE&limit=20',
      );
      // Backend wraps response in { success, data: { items, nextCursor } }
      final auctionResponse =
          (auctionRaw is Map && auctionRaw.containsKey('data'))
          ? auctionRaw['data'] as Map<String, dynamic>
          : auctionRaw as Map<String, dynamic>;
      final items = (auctionResponse['items'] as List<dynamic>? ?? const []);

      List<Map<String, dynamic>> resolvedShops = const <Map<String, dynamic>>[];
      try {
        final shopsRaw = await _backendApiService.get('/pawnshops');
        // Backend wraps response in { success, data: [...] }
        final shopsPayload = (shopsRaw is Map && shopsRaw.containsKey('data'))
            ? shopsRaw['data']
            : shopsRaw;
        resolvedShops = (shopsPayload is List<dynamic>)
            ? shopsPayload
                  .map((entry) => Map<String, dynamic>.from(entry as Map))
                  .toList()
            : <Map<String, dynamic>>[];
      } catch (_) {
        resolvedShops = const <Map<String, dynamic>>[];
      }

      setState(() {
        _shops = resolvedShops.where((shop) {
          final status = (shop['status'] ?? '').toString().toUpperCase();
          return status != 'TRIAL';
        }).toList();
        _liveAuctionCount = items.length;
        _selectedShopIndex = null;
        _routeActive = false;
        _routePoints = const [];
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Unable to load system data: $e';
        _loading = false;
      });
    }
  }

  // ── Interactions ─────────────────────────────────────────────────

  void _onBranchTap(int index) {
    final shop = _shops[index];
    final point = _shopPoint(shop);
    if (point == null) {
      // No GPS → just navigate to pawn ticket screen
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PawnTicketScreen(pawnshopId: shop['id'] as String?),
        ),
      );
      return;
    }
    // Toggle selection → show/hide route
    setState(() {
      if (_selectedShopIndex == index) {
        _selectedShopIndex = null;
        _routeActive = false;
        _routePoints = const [];
      } else {
        _selectedShopIndex = index;
        _routeActive = true;
        _routePoints = _userLat != null && _userLng != null
            ? [LatLng(_userLat!, _userLng!), point]
            : const [];
      }
    });

    if (_selectedShopIndex == null) {
      _focusAllOnMap();
    } else {
      _focusShop(index);
    }

    // Collapse sheet to show the map route
    _sheetController.animateTo(
      0.28,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOut,
    );
  }

  void _openDirections(Map<String, dynamic> shop) {
    final point = _shopPoint(shop);
    if (point == null) return;
    final url = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}',
    );
    launchUrl(url, mode: LaunchMode.externalApplication);
  }

  // ── Build ────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final query = _shopSearchQuery.trim().toLowerCase();
    final visibleShopIndices = List<int>.generate(_shops.length, (i) => i)
        .where((i) {
          if (query.isEmpty) return true;
          final shop = _shops[i];
          final name = (shop['name'] ?? '').toString().toLowerCase();
          final address = (shop['address'] ?? '').toString().toLowerCase();
          return name.contains(query) || address.contains(query);
        })
        .toList();

    // Hide GPS badge when sheet is pulled past 55%
    final showGps = _sheetExtent < 0.55 && _userLat != null && _userLng != null;
    // Show "expanded" header style when sheet is large
    final bool sheetExpanded = _sheetExtent > 0.6;
    final mapMarkers = <Marker>[
      ...visibleShopIndices.map((shopIndex) {
        final shop = _shops[shopIndex];
        final point = _shopPoint(shop);
        if (point == null) return null;

        final isSelected = _selectedShopIndex == shopIndex;

        return Marker(
          point: point,
          width: 42,
          height: 42,
          child: Icon(
            Icons.location_on,
            size: isSelected ? 40 : 34,
            color: isSelected ? AppTheme.gold : Colors.redAccent,
          ),
        );
      }).whereType<Marker>(),
      if (_userLat != null && _userLng != null)
        Marker(
          point: LatLng(_userLat!, _userLng!),
          width: 28,
          height: 28,
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF4285F4),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
            ),
          ),
        ),
    ];

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
        // ── Map ──
        SizedBox.expand(
          child: _loading
              ? Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppTheme.darkBg, AppTheme.darkBgSecondary],
                    ),
                  ),
                  child: const Center(
                    child: CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation(AppTheme.gold),
                    ),
                  ),
                )
              : FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: _initialCenter(),
                    initialZoom: 12,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.pawngold.mobile',
                    ),
                    if (_routePoints.length >= 2)
                      PolylineLayer(
                        polylines: [
                          Polyline(
                            points: _routePoints,
                            color: AppTheme.gold,
                            strokeWidth: 4,
                          ),
                        ],
                      ),
                    MarkerLayer(markers: mapMarkers),
                  ],
                ),
        ),

        // ── Map controls ──
        if (!_loading)
          Positioned(
            right: 16,
            bottom: ((MediaQuery.of(context).size.height * _sheetExtent) + 16)
                .clamp(16.0, MediaQuery.of(context).size.height * 0.92),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_routeActive)
                  _mapButton(
                    icon: Icons.close,
                    tooltip: 'Clear route',
                    onTap: () {
                      setState(() {
                        _selectedShopIndex = null;
                        _routeActive = false;
                        _routePoints = const [];
                      });
                      _focusAllOnMap();
                    },
                  ),
                const SizedBox(height: 8),
                _mapButton(
                  icon: Icons.my_location,
                  tooltip: 'My location',
                  onTap: () async {
                    final ok = await _getUserLocation(showFeedback: true);
                    if (ok && _userLat != null && _userLng != null) {
                      _mapController.move(LatLng(_userLat!, _userLng!), 15);
                    }
                  },
                ),
                const SizedBox(height: 8),
                _mapButton(
                  icon: Icons.fit_screen,
                  tooltip: 'Fit all',
                  onTap: _focusAllOnMap,
                ),
              ],
            ),
          ),

        // ── Top bar: search + notification bell ──
        Positioned.fill(
          child: Align(
            alignment: Alignment.topCenter,
            child: AnimatedOpacity(
              opacity: _sheetExtent > 0.65 ? 0.0 : 1.0,
              duration: const Duration(milliseconds: 200),
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _searchController,
                        onChanged: (value) {
                          setState(() {
                            _shopSearchQuery = value;
                          });
                        },
                        decoration:
                            AppTheme.inputDecoration(
                              "Search premium shops...",
                            ).copyWith(
                              prefixIcon: const Icon(
                                Icons.search,
                                color: AppTheme.gold,
                              ),
                            ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    GestureDetector(
                      onTap: () {
                        _showNotificationsSheet();
                        _markAllNotificationsAsRead();
                      },
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppTheme.surface.withValues(alpha: 0.92),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.08),
                          ),
                        ),
                        child: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            const Center(
                              child: Icon(
                                Icons.notifications_outlined,
                                color: AppTheme.gold,
                                size: 22,
                              ),
                            ),
                            if (_unreadNotifCount > 0)
                              Positioned(
                                top: -4,
                                right: -4,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 5,
                                    vertical: 1,
                                  ),
                                  constraints: const BoxConstraints(
                                    minWidth: 16,
                                    minHeight: 16,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.red.shade500,
                                    borderRadius: BorderRadius.circular(20),
                                    border: Border.all(
                                      color: AppTheme.surface,
                                      width: 1.5,
                                    ),
                                  ),
                                  child: Text(
                                    _unreadNotifCount > 99
                                        ? '99+'
                                        : '$_unreadNotifCount',
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w700,
                                      height: 1.1,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  ),
                ),
              ),
            ),
          ),
        ),

        // ── Bottom sheet ──
        DraggableScrollableSheet(
          controller: _sheetController,
          initialChildSize: 0.38,
          minChildSize: 0.15,
          maxChildSize: 0.92,
          snap: true,
          snapSizes: const [0.15, 0.38, 0.92],
          builder: (context, scrollController) {
            return Container(
              decoration: BoxDecoration(
                color: AppTheme.surface,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.4),
                    blurRadius: 20,
                    offset: const Offset(0, -4),
                  ),
                ],
              ),
              child: CustomScrollView(
                controller: scrollController,
                slivers: [
                  // ── Drag handle ──
                  SliverToBoxAdapter(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 12, bottom: 8),
                        child: Container(
                          width: 40,
                          height: 4,
                          decoration: BoxDecoration(
                            color: Colors.white24,
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                    ),
                  ),

                  // ── Header ──
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  "Connected Branches",
                                  style: TextStyle(
                                    fontSize: sheetExpanded ? 26 : 22,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              if (sheetExpanded)
                                IconButton(
                                  icon: const Icon(
                                    Icons.keyboard_arrow_down,
                                    color: AppTheme.gold,
                                  ),
                                  onPressed: () => _sheetController.animateTo(
                                    0.38,
                                    duration: const Duration(milliseconds: 350),
                                    curve: Curves.easeOut,
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.gold.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  'Live Auctions: $_liveAuctionCount',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppTheme.gold,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.06),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  '${visibleShopIndices.length} Branches',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppTheme.textMuted,
                                  ),
                                ),
                              ),
                              const Spacer(),
                              GestureDetector(
                                onTap: _loading ? null : _loadData,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons.refresh,
                                      size: 14,
                                      color: _loading
                                          ? AppTheme.textMuted
                                          : AppTheme.gold,
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      'Refresh',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: _loading
                                            ? AppTheme.textMuted
                                            : AppTheme.gold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          // GPS badge — animated in/out
                          AnimatedCrossFade(
                            firstChild: Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Row(
                                children: [
                                  const Icon(
                                    Icons.my_location,
                                    size: 13,
                                    color: Color(0xFF4285F4),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'GPS: ${_userLat?.toStringAsFixed(4) ?? '-'}, ${_userLng?.toStringAsFixed(4) ?? '-'}',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppTheme.textMuted,
                                      fontFamily: 'monospace',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            secondChild: const SizedBox.shrink(),
                            crossFadeState: showGps
                                ? CrossFadeState.showFirst
                                : CrossFadeState.showSecond,
                            duration: const Duration(milliseconds: 250),
                          ),
                          const SizedBox(height: 12),
                        ],
                      ),
                    ),
                  ),

                  // ── Active Tickets (only WAITING/SERVING) ──
                  if (_activeTickets
                      .where(
                        (t) =>
                            t['status'] == 'WAITING' ||
                            t['status'] == 'SERVING',
                      )
                      .isNotEmpty) ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(
                                  Icons.confirmation_number,
                                  color: AppTheme.gold,
                                  size: 18,
                                ),
                                const SizedBox(width: 8),
                                const Text(
                                  'Active Tickets',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.white,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppTheme.gold.withValues(
                                      alpha: 0.15,
                                    ),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Text(
                                    '${_activeTickets.where((t) => t['status'] == 'WAITING' || t['status'] == 'SERVING').length}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: AppTheme.gold,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                          ],
                        ),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final active = _activeTickets
                                .where(
                                  (t) =>
                                      t['status'] == 'WAITING' ||
                                      t['status'] == 'SERVING',
                                )
                                .toList();
                            return _buildTicketCard(active[index]);
                          },
                          childCount: _activeTickets
                              .where(
                                (t) =>
                                    t['status'] == 'WAITING' ||
                                    t['status'] == 'SERVING',
                              )
                              .length,
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(child: SizedBox(height: 16)),
                  ],

                  // ── Branch list ──
                  if (_loading)
                    const SliverFillRemaining(
                      child: Center(
                        child: CircularProgressIndicator(
                          valueColor: AlwaysStoppedAnimation(AppTheme.gold),
                        ),
                      ),
                    )
                  else if (_error != null)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Colors.redAccent),
                        ),
                      ),
                    )
                  else if (_shops.isEmpty)
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'No pawnshop branches found.',
                          style: TextStyle(color: AppTheme.textMuted),
                        ),
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) =>
                              _buildBranchCard(visibleShopIndices[index]),
                          childCount: visibleShopIndices.length,
                        ),
                      ),
                    ),

                  // Extra bottom padding for safe area
                  const SliverToBoxAdapter(child: SizedBox(height: 40)),
                ],
              ),
            );
          },
        ),
        ],
      ),
    );
  }

  // ── Ticket card widget ───────────────────────────────────────────

  Widget _buildTicketCard(Map<String, dynamic> ticket) {
    final queueNumber =
        ticket['queueNumber']?.toString() ??
        ticket['queue_number']?.toString() ??
        '---';
    final status = ticket['status']?.toString().toUpperCase() ?? 'WAITING';
    final queueType =
        ticket['queueType']?.toString() ??
        ticket['queue_type']?.toString() ??
        '';
    final pawnshop = ticket['pawnshop'];
    final pawnshopName =
        (pawnshop is Map ? pawnshop['name'] : null)?.toString() ?? 'Branch';
    final notes = ticket['notes']?.toString() ?? '';
    final estimatedWait =
        ticket['estimatedWaitMinutes'] ?? ticket['estimated_wait_minutes'];
    final counterNumber =
        ticket['counterNumber']?.toString() ??
        ticket['counter_number']?.toString();

    Color statusColor;
    IconData statusIcon;
    String statusLabel;
    switch (status) {
      case 'SERVING':
        statusColor = const Color(0xFF4CAF50);
        statusIcon = Icons.play_circle_filled;
        statusLabel = 'Now Serving';
        break;
      case 'COMPLETED':
        statusColor = Colors.grey;
        statusIcon = Icons.check_circle;
        statusLabel = 'Completed';
        break;
      default:
        statusColor = AppTheme.gold;
        statusIcon = Icons.hourglass_top;
        statusLabel = 'Waiting';
    }

    return GestureDetector(
      onTap: () {
        final ticketId = ticket['id']?.toString() ?? '';
        if (ticketId.isNotEmpty) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) =>
                  TicketChatScreen(ticketId: ticketId, ticket: ticket),
            ),
          );
        }
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.darkBgSecondary,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: status == 'SERVING'
                ? statusColor.withValues(alpha: 0.5)
                : Colors.white.withValues(alpha: 0.06),
            width: status == 'SERVING' ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            // Queue number badge
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    queueNumber,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 13,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w800,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                  ),
                  Icon(statusIcon, color: statusColor, size: 14),
                ],
              ),
            ),
            const SizedBox(width: 12),
            // Details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          pawnshopName,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: statusColor.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            statusLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: statusColor,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  if (notes.isNotEmpty)
                    Text(
                      notes,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      if (queueType.isNotEmpty)
                        Text(
                          queueType.replaceAll('_', ' '),
                          style: TextStyle(
                            color: AppTheme.gold.withValues(alpha: 0.7),
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      if (status == 'WAITING' && estimatedWait != null) ...[
                        Icon(
                          Icons.access_time,
                          size: 12,
                          color: Colors.white.withValues(alpha: 0.5),
                        ),
                        Text(
                          '~$estimatedWait min',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.5),
                            fontSize: 11,
                          ),
                        ),
                      ],
                      if (status == 'SERVING' && counterNumber != null) ...[
                        Icon(Icons.meeting_room, size: 12, color: statusColor),
                        Text(
                          'Counter $counterNumber',
                          style: TextStyle(
                            color: statusColor,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ),
                  // Chat hint
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(
                        Icons.chat_bubble_outline,
                        size: 12,
                        color: AppTheme.gold.withValues(alpha: 0.5),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Tap to chat',
                        style: TextStyle(
                          color: AppTheme.gold.withValues(alpha: 0.5),
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              color: Colors.white.withValues(alpha: 0.3),
              size: 20,
            ),
          ],
        ),
      ),
    );
  }

  // ── Notifications sheet ──────────────────────────────────────────

  void _showNotificationsSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      isScrollControlled: true,
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (_, scrollCtrl) {
            return Column(
              children: [
                // Handle
                Padding(
                  padding: const EdgeInsets.only(top: 12, bottom: 8),
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                // Header
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.notifications,
                        color: AppTheme.gold,
                        size: 22,
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'Notifications',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Spacer(),
                      if (_unreadNotifCount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.gold.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '$_unreadNotifCount new',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.gold,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const Divider(height: 1, color: Colors.white10),
                // List
                Expanded(
                  child: _notifications.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.notifications_none,
                                size: 48,
                                color: Colors.white.withValues(alpha: 0.2),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'No notifications yet',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.4),
                                  fontSize: 14,
                                ),
                              ),
                            ],
                          ),
                        )
                      : ListView.separated(
                          controller: scrollCtrl,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          itemCount: _notifications.length,
                          separatorBuilder: (_, __) =>
                              const Divider(height: 1, color: Colors.white10),
                          itemBuilder: (_, i) {
                            final n = _notifications[i];
                            final isRead = n['status']?.toString() == 'READ';
                            final title =
                                n['title']?.toString() ?? 'Notification';
                            final body = n['body']?.toString() ?? '';
                            final type = n['type']?.toString() ?? '';

                            IconData icon;
                            Color iconColor;
                            switch (type) {
                              case 'QUEUE_READY':
                                icon = Icons.notifications_active;
                                iconColor = AppTheme.gold;
                                break;
                              case 'AUCTION_WON':
                                icon = Icons.emoji_events;
                                iconColor = const Color(0xFF4CAF50);
                                break;
                              case 'AUCTION_OUTBID':
                                icon = Icons.trending_down;
                                iconColor = Colors.redAccent;
                                break;
                              default:
                                icon = Icons.info_outline;
                                iconColor = Colors.blueAccent;
                            }

                            return ListTile(
                              onTap: () {
                                if (isRead) return;
                                final id = n['id']?.toString() ?? '';
                                final type = n['type']?.toString() ?? '';
                                final title = n['title']?.toString() ?? '';
                                final body = n['body']?.toString() ?? '';
                                if (id.isEmpty) return;

                                setState(() {
                                  _locallyReadNotificationIds.add(id);
                                  _mutedNotificationFingerprints.add(
                                    '$type|$title|$body',
                                  );
                                  _notifications[i]['status'] = 'READ';
                                  final localIndex = _localQueueNotifications
                                      .indexWhere(
                                        (entry) =>
                                            entry['id']?.toString() == id,
                                      );
                                  if (localIndex >= 0) {
                                    _localQueueNotifications[localIndex]['status'] =
                                        'READ';
                                  }
                                  _unreadNotifCount = (_unreadNotifCount - 1)
                                      .clamp(0, _notifications.length);
                                });
                                _persistNotificationReadCache();
                                _markNotificationAsRead(id);
                              },
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 4,
                                vertical: 6,
                              ),
                              leading: Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: iconColor.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(icon, color: iconColor, size: 20),
                              ),
                              title: Text(
                                title,
                                style: TextStyle(
                                  fontWeight: isRead
                                      ? FontWeight.w400
                                      : FontWeight.w600,
                                  fontSize: 14,
                                  color: Colors.white,
                                ),
                              ),
                              subtitle: Text(
                                body,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.white.withValues(alpha: 0.6),
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: !isRead
                                  ? Container(
                                      width: 8,
                                      height: 8,
                                      decoration: const BoxDecoration(
                                        color: AppTheme.gold,
                                        shape: BoxShape.circle,
                                      ),
                                    )
                                  : null,
                            );
                          },
                        ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // ── Branch card widget ───────────────────────────────────────────

  Widget _buildBranchCard(int index) {
    final shop = _shops[index];
    final name = (shop['name'] as String?) ?? 'Unnamed Branch';
    final hasLocation = shop['latitude'] != null && shop['longitude'] != null;
    final isSelected = _selectedShopIndex == index;
    final distance = _formatDistance(shop);

    return GestureDetector(
      onTap: () => _onBranchTap(index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected
              ? AppTheme.gold.withValues(alpha: 0.1)
              : AppTheme.darkBgSecondary,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected
                ? AppTheme.gold.withValues(alpha: 0.5)
                : Colors.white.withValues(alpha: 0.06),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top row: icon + name + distance
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: hasLocation
                        ? AppTheme.gold.withValues(alpha: 0.15)
                        : Colors.white.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    hasLocation
                        ? Icons.location_on
                        : Icons.location_off_outlined,
                    color: hasLocation ? AppTheme.gold : AppTheme.textMuted,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        distance,
                        style: const TextStyle(
                          color: AppTheme.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                if (isSelected)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.gold,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'ROUTE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: Colors.black,
                      ),
                    ),
                  )
                else
                  const Icon(
                    Icons.chevron_right,
                    color: AppTheme.gold,
                    size: 20,
                  ),
              ],
            ),
            // Action buttons (visible when selected)
            if (isSelected) ...[
              const SizedBox(height: 12),
              const Divider(height: 1, color: Colors.white10),
              const SizedBox(height: 10),
              Row(
                children: [
                  _actionChip(
                    icon: Icons.navigation_outlined,
                    label: 'Directions',
                    onTap: () => _openDirections(shop),
                  ),
                  const SizedBox(width: 8),
                  _actionChip(
                    icon: Icons.center_focus_strong,
                    label: 'Focus',
                    onTap: () {
                      _focusShop(index);
                      _sheetController.animateTo(
                        0.15,
                        duration: const Duration(milliseconds: 350),
                        curve: Curves.easeOut,
                      );
                    },
                  ),
                  const SizedBox(width: 8),
                  _actionChip(
                    icon: Icons.receipt_long,
                    label: 'Ticket',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) =>
                            PawnTicketScreen(pawnshopId: shop['id'] as String?),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _actionChip({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: AppTheme.gold),
              const SizedBox(width: 5),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  color: AppTheme.textMuted,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _mapButton({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppTheme.surface.withValues(alpha: 0.9),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.3),
              blurRadius: 8,
            ),
          ],
        ),
        child: Icon(icon, size: 18, color: AppTheme.gold),
      ),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────

  String _formatDistance(Map<String, dynamic> shop) {
    if (shop['latitude'] == null || shop['longitude'] == null) {
      return (shop['address'] as String?) ?? 'No address available';
    }
    if (_userLat != null && _userLng != null) {
      final dist = _haversine(
        _userLat!,
        _userLng!,
        (shop['latitude'] as num).toDouble(),
        (shop['longitude'] as num).toDouble(),
      );
      if (dist < 1) return '${(dist * 1000).round()} m away';
      return '${dist.toStringAsFixed(1)} km away';
    }
    return (shop['address'] as String?) ?? 'Location pinned';
  }

  double _haversine(double lat1, double lon1, double lat2, double lon2) {
    const R = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180;
    final dLon = (lon2 - lon1) * math.pi / 180;
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180) *
            math.cos(lat2 * math.pi / 180) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return R * c;
  }
}

// --- SCREEN 3 & 4: SUBMIT TICKET (IMAGE_13925A & IMAGE_13927E) ---
class PawnTicketScreen extends StatefulWidget {
  final String? pawnshopId;
  const PawnTicketScreen({super.key, this.pawnshopId});
  @override
  State<PawnTicketScreen> createState() => _PawnTicketScreenState();
}

class _PawnTicketScreenState extends State<PawnTicketScreen> {
  final _formKey = GlobalKey<FormState>();
  final BackendApiService _api = BackendApiService();
  String? _selectedType;
  final List<Map<String, String>> _queueTypes = [
    {'value': 'PAWNING', 'label': 'Pawning'},
    {'value': 'RENEWAL', 'label': 'Renewal'},
    {'value': 'REDEMPTION', 'label': 'Redemption'},
    {'value': 'AUCTION_INQUIRY', 'label': 'Auction Inquiry'},
    {'value': 'GENERAL', 'label': 'General'},
  ];

  final _descCtrl = TextEditingController();
  bool _isLoading = false;

  Future<void> _submitTicket() async {
    if (!_formKey.currentState!.validate() || _selectedType == null) return;

    final selectedPawnshopId = (widget.pawnshopId ?? '').trim();
    if (selectedPawnshopId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a branch first before creating a queue ticket.'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      final session = Supabase.instance.client.auth.currentSession;
      final result = await _api.post(
        '/queue/mobile',
        data: {
          'queueType': _selectedType,
          'description': _descCtrl.text.isNotEmpty ? _descCtrl.text : null,
          'pawnshopId': selectedPawnshopId,
        },
        accessToken: session?.accessToken,
      );
      if (mounted) {
        final payload = (result is Map && result['data'] is Map)
            ? result['data']
            : result;
        final queueNum = payload is Map ? payload['queueNumber'] ?? '' : '';
        final waitMin = payload is Map
            ? payload['estimatedWaitMinutes'] ?? 0
            : 0;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Queue ticket $queueNum created! Est. wait: $waitMin min',
            ),
            backgroundColor: AppTheme.gold,
          ),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to submit: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("New Queue Ticket"),
        backgroundColor: Colors.transparent,
      ),
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                "New Queue Ticket",
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                "Select the purpose of your visit",
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 25),
              _label("Purpose"),
              ..._queueTypes.map(
                (t) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => setState(() => _selectedType = t['value']),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      decoration: BoxDecoration(
                        color: _selectedType == t['value']
                            ? AppTheme.gold.withValues(alpha: 0.12)
                            : AppTheme.darkBgSecondary,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: _selectedType == t['value']
                              ? AppTheme.gold
                              : Colors.white.withValues(alpha: 0.08),
                          width: _selectedType == t['value'] ? 1.5 : 1,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            _selectedType == t['value']
                                ? Icons.radio_button_checked
                                : Icons.radio_button_off,
                            color: _selectedType == t['value']
                                ? AppTheme.gold
                                : Colors.white.withValues(alpha: 0.4),
                            size: 20,
                          ),
                          const SizedBox(width: 12),
                          Text(
                            t['label']!,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: _selectedType == t['value']
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                              color: _selectedType == t['value']
                                  ? AppTheme.gold
                                  : Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (_selectedType == null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Please select a purpose',
                    style: TextStyle(color: Colors.red.shade300, fontSize: 12),
                  ),
                ),
              const SizedBox(height: 12),
              _label("Additional Notes (optional)"),
              TextFormField(
                controller: _descCtrl,
                maxLines: 3,
                decoration: AppTheme.inputDecoration(
                  "Any details about your visit...",
                ),
              ),
              const SizedBox(height: 30),
              SizedBox(
                width: double.infinity,
                height: 55,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _submitTicket,
                  child: _isLoading
                      ? const CircularProgressIndicator(color: Colors.black)
                      : const Text(
                          "SUBMIT TICKET",
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(color: AppTheme.gold, fontSize: 12),
    ),
  );
}

// --- SCREEN 5 & 6: LOANS/VAULT (IMAGE_1399DF & IMAGE_139A37) ---
class LoansScreen extends StatefulWidget {
  const LoansScreen({super.key});

  @override
  State<LoansScreen> createState() => _LoansScreenState();
}

class _LoansScreenState extends State<LoansScreen> with WidgetsBindingObserver {
  final BackendApiService _api = BackendApiService();
  List<Map<String, dynamic>> _loans = [];
  bool _loading = true;
  String? _error;
  final Set<int> _payingTicketIds = <int>{};
  final Map<int, String> _pendingPaymentLinks = <int, String>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadLoans();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _confirmPendingPayments();
    }
  }

  Future<void> _confirmPendingPayments() async {
    if (_pendingPaymentLinks.isEmpty) {
      await _loadLoans();
      return;
    }

    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) {
      await _loadLoans();
      return;
    }

    final entries = _pendingPaymentLinks.entries.toList();
    for (final entry in entries) {
      try {
        final raw = await _api.post(
          '/loans/${entry.key}/confirm-payment',
          accessToken: session.accessToken,
          data: {'paymentLinkId': entry.value},
        );
        final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
        final status = payload is Map ? payload['status']?.toString() : null;
        if (status == 'REDEEMED') {
          _pendingPaymentLinks.remove(entry.key);
        }
      } catch (_) {
        // Keep pending item and retry on next resume.
      }
    }

    await _loadLoans();
  }

  Future<void> _loadLoans() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) {
        throw Exception('Not authenticated');
      }

      final raw = await _api.get(
        '/loans/my-items',
        accessToken: session.accessToken,
      );
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List items = payload is List ? payload : [];

      if (!mounted) return;
      setState(() {
        _loans = items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  double _totalAssetValue() {
    double sum = 0;
    for (final loan in _loans) {
      final totalDue = loan['totalDue'];
      if (totalDue is num) {
        sum += totalDue.toDouble();
      }
    }
    return sum;
  }

  String _money(num value) {
    return value.toStringAsFixed(0);
  }

  Future<void> _payNow(Map<String, dynamic> loan) async {
    final ticketIdRaw = loan['ticketId'];
    final ticketId = ticketIdRaw is num ? ticketIdRaw.toInt() : null;
    if (ticketId == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid ticket id for payment')),
      );
      return;
    }

    setState(() => _payingTicketIds.add(ticketId));

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) {
        throw Exception('Not authenticated');
      }

      final raw = await _api.post(
        '/loans/$ticketId/pay-link',
        accessToken: session.accessToken,
      );

      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final checkoutUrl = payload is Map
          ? payload['checkoutUrl']?.toString()
          : null;
      final paymentLinkId = payload is Map
          ? (payload['paymentLinkId'] ?? payload['checkoutReferenceId'])
            ?.toString()
          : null;
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        throw Exception('No checkout URL returned by server');
      }
      if (paymentLinkId == null || paymentLinkId.isEmpty) {
        throw Exception('No paymentLinkId returned by server');
      }

      _pendingPaymentLinks[ticketId] = paymentLinkId;

      final uri = Uri.parse(checkoutUrl);
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!launched) {
        throw Exception('Unable to open checkout URL');
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Payment link failed: $e'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _payingTicketIds.remove(ticketId));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadLoans,
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(24, 60, 24, 30),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppTheme.surfaceElevated, AppTheme.surface],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
                borderRadius: BorderRadius.vertical(
                  bottom: Radius.circular(30),
                ),
              ),
              child: Column(
                children: [
                  const Text(
                    "Total Asset Value",
                    style: TextStyle(color: AppTheme.textMuted),
                  ),
                  Text(
                    "₱${_money(_totalAssetValue())}",
                    style: const TextStyle(
                      fontSize: 36,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.gold,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(
                      child: CircularProgressIndicator(color: AppTheme.gold),
                    )
                  : _error != null
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(24),
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: AppTheme.cardDecoration,
                          child: Column(
                            children: [
                              const Icon(
                                Icons.error_outline,
                                color: Colors.redAccent,
                                size: 32,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Failed to load loans',
                                style: TextStyle(
                                  color: Colors.red.shade300,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                _error!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppTheme.textMuted,
                                ),
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 12),
                              OutlinedButton(
                                onPressed: _loadLoans,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                      ],
                    )
                  : ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(24),
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              "Active Loans",
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              '${_loans.length}',
                              style: const TextStyle(
                                color: AppTheme.gold,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 15),
                        if (_loans.isEmpty)
                          Container(
                            padding: const EdgeInsets.all(18),
                            decoration: AppTheme.cardDecoration,
                            child: const Column(
                              children: [
                                Icon(
                                  Icons.inventory_2_outlined,
                                  size: 34,
                                  color: AppTheme.textMuted,
                                ),
                                SizedBox(height: 10),
                                Text(
                                  'No active pawned items yet',
                                  style: TextStyle(fontWeight: FontWeight.w700),
                                ),
                                SizedBox(height: 4),
                                Text(
                                  'Items linked to your account will appear here.',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppTheme.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ..._loans.map(_loanCard),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _loanCard(Map<String, dynamic> loan) {
    final title = (loan['itemName'] ?? loan['category'] ?? 'Pawned Item')
        .toString();
    final totalDue = loan['totalDue'];
    final totalDueNum = totalDue is num ? totalDue.toDouble() : 0.0;
    final daysRemainingRaw = loan['daysRemaining'];
    final daysRemaining = daysRemainingRaw is num
        ? daysRemainingRaw.toInt()
        : 0;
    final progressRaw = loan['progress'];
    final progress = progressRaw is num
        ? progressRaw.toDouble().clamp(0.0, 1.0)
        : 0.0;
    final status = (loan['status'] ?? 'ACTIVE').toString();
    final ticketIdRaw = loan['ticketId'];
    final ticketId = ticketIdRaw is num ? ticketIdRaw.toInt() : -1;
    final isPaying = _payingTicketIds.contains(ticketId);

    final bool nearDue = daysRemaining <= 3;
    final Color accent = nearDue ? Colors.red.shade400 : AppTheme.gold;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.cardDecoration,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(child: Text(title, overflow: TextOverflow.ellipsis)),
              Text(
                "₱${_money(totalDueNum)}",
                style: TextStyle(color: accent, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: accent,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          LinearProgressIndicator(
            value: progress,
            color: accent,
            backgroundColor: Colors.white10,
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                daysRemaining >= 0 ? '$daysRemaining days left' : 'Overdue',
                style: const TextStyle(fontSize: 12, color: AppTheme.textMuted),
              ),
              TextButton(
                onPressed: isPaying ? null : () => _payNow(loan),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  minimumSize: const Size(0, 0),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: isPaying
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.gold,
                        ),
                      )
                    : const Text(
                        'Pay Now',
                        style: TextStyle(color: AppTheme.gold, fontSize: 12),
                      ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// --- SCREEN 7: AUCTION HOUSE (IMAGE_139A55) ---
class AuctionScreen extends StatelessWidget {
  const AuctionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const _AuctionScreenBody();
  }
}

class _AuctionScreenBody extends StatefulWidget {
  const _AuctionScreenBody();

  @override
  State<_AuctionScreenBody> createState() => _AuctionScreenBodyState();
}

class _AuctionScreenBodyState extends State<_AuctionScreenBody>
    with WidgetsBindingObserver {
  final BackendApiService _backendApiService = BackendApiService();

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _listings = [];
  final Set<int> _placingBidListingIds = <int>{};
  MobileKycStatus _kycStatus = MobileKycStatus.notSubmitted;
  bool _tosAccepted = false;

  double _asDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) {
      return double.tryParse(value.replaceAll(',', '')) ?? 0.0;
    }
    return 0.0;
  }

  dynamic _listingValue(Map<String, dynamic> listing, List<String> keys) {
    for (final key in keys) {
      if (listing.containsKey(key) && listing[key] != null) {
        return listing[key];
      }
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadKycStatus();
    _loadTosStatus();
    _loadListings();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _loadKycStatus();
      _loadListings();
    }
  }

  Future<void> _loadKycStatus() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) {
        if (!mounted) return;
        setState(() => _kycStatus = MobileKycStatus.notSubmitted);
        return;
      }

      final response = await _backendApiService.get(
        '/auth/kyc/status',
        accessToken: session.accessToken,
      );

      final payload = response is Map && response.containsKey('data')
          ? response['data'] as Map<String, dynamic>
          : response as Map<String, dynamic>;
      final status = (payload['kycStatus'] as String?) ?? 'NOT_SUBMITTED';

      if (!mounted) return;
      setState(() {
        switch (status.toUpperCase()) {
          case 'VERIFIED':
            _kycStatus = MobileKycStatus.verified;
            break;
          case 'PENDING':
            _kycStatus = MobileKycStatus.verified;
            break;
          case 'REJECTED':
            _kycStatus = MobileKycStatus.rejected;
            break;
          default:
            _kycStatus = MobileKycStatus.notSubmitted;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _kycStatus = MobileKycStatus.notSubmitted);
    }
  }

  Future<void> _loadTosStatus() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;
    try {
      final response = await _backendApiService.get(
        '/auction/bidders/tos-status',
        accessToken: session.accessToken,
      );
      final payload = response is Map && response.containsKey('data')
          ? response['data'] as Map<String, dynamic>
          : response as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _tosAccepted = payload['accepted'] == true;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _tosAccepted = false;
        });
      }
    }
  }

  String _kycBidBlockMessage() {
    switch (_kycStatus) {
      case MobileKycStatus.pending:
        return 'Your KYC is still under review. You can place bids after approval.';
      case MobileKycStatus.rejected:
        return 'Your KYC was rejected. Please resubmit verification to continue bidding.';
      case MobileKycStatus.notSubmitted:
        return 'Please complete KYC verification first before placing bids.';
      case MobileKycStatus.verified:
        return '';
    }
  }

  Future<bool> _checkTos() async {
    await _loadTosStatus();
    return _tosAccepted;
  }

  Future<void> _showTosDialog(Map<String, dynamic> listing) async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Auction Bidder Agreement'),
        content: const SingleChildScrollView(
          child: Text(
            'By placing a bid you agree to the Auction Bidder Agreement. This includes binding terms for item authenticity, payment obligations, shipping policies, and dispute resolution. Your bid is a legally binding commitment to purchase the item if you are the winning bidder.\n\n'
            'You must accept these terms before you can place bids. Your acceptance will be recorded as part of the auction audit trail.',
            style: TextStyle(fontSize: 13, height: 1.5),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              try {
                await _backendApiService.post(
                  '/auction/bidders/accept-tos',
                  accessToken: session.accessToken,
                  data: {'listingId': listing['id']},
                );
                if (!mounted) return;
                setState(() => _tosAccepted = true);
                Navigator.of(ctx).pop();
                _showBidDialog(listing);
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Failed to accept terms: $e'),
                    backgroundColor: Colors.red.shade700,
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.gold,
              foregroundColor: Colors.black,
            ),
            child: const Text('I Agree'),
          ),
        ],
      ),
    );
  }

  Future<void> _showBidDialog(Map<String, dynamic> listing) async {
    await _loadKycStatus();
    if (_kycStatus != MobileKycStatus.verified) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_kycBidBlockMessage()),
          backgroundColor: Colors.red.shade700,
        ),
      );
      return;
    }

    final tosOk = await _checkTos();
    if (!tosOk) {
      if (!mounted) return;
      _showTosDialog(listing);
      return;
    }

    final listingIdRaw = listing['id'];
    final listingId = listingIdRaw is num ? listingIdRaw.toInt() : null;
    if (listingId == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Invalid listing id')));
      return;
    }

    final currentBid = _asDouble(
      _listingValue(listing, ['currentBid', 'current_bid']),
    );
    final startingPrice = _asDouble(
      _listingValue(listing, ['startingPrice', 'starting_price']),
    );
    final minIncrementRaw = _asDouble(
      _listingValue(listing, ['minBidIncrement', 'min_bid_increment']),
    );
    final minInc = minIncrementRaw > 0 ? minIncrementRaw : 100.0;
    final effectiveCurrentBid = currentBid > 0 ? currentBid : startingPrice;
    final suggestedMin =
        (effectiveCurrentBid > 0 ? effectiveCurrentBid : 0) + minInc;
    final recommendedMin = suggestedMin.ceilToDouble();

    final bidCtrl = TextEditingController(
      text: recommendedMin.toStringAsFixed(0),
    );

    if (!mounted) return;

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Place Bid'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              (listing['title'] as String?) ?? 'Auction Item',
              style: const TextStyle(fontWeight: FontWeight.w700),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 8),
            Text(
              'Minimum: ₱${recommendedMin.toStringAsFixed(0)}',
              style: const TextStyle(color: AppTheme.textMuted, fontSize: 12),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: bidCtrl,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: AppTheme.inputDecoration('Bid amount (PHP)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: _placingBidListingIds.contains(listingId)
                ? null
                : () async {
                    final rawAmount = double.tryParse(bidCtrl.text.trim());
                    if (rawAmount == null || rawAmount <= 0) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Please enter a valid bid amount'),
                        ),
                      );
                      return;
                    }
                    if (rawAmount < recommendedMin) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Minimum allowed bid is ₱${recommendedMin.toStringAsFixed(0)}.',
                          ),
                        ),
                      );
                      bidCtrl.text = recommendedMin.toStringAsFixed(0);
                      return;
                    }
                    final pawnshopId =
                        (listing['pawnshopId']?.toString() ??
                            (listing['pawnshop'] is Map
                                ? (listing['pawnshop']['id']?.toString() ?? '')
                                : ''))
                        .trim();
                    final ok = await _placeBid(
                      listingId,
                      rawAmount,
                      pawnshopId: pawnshopId.isEmpty ? null : pawnshopId,
                    );
                    if (ok && ctx.mounted) {
                      Navigator.of(ctx).pop();
                    }
                  },
            child: _placingBidListingIds.contains(listingId)
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.black,
                    ),
                  )
                : const Text('Place Bid'),
          ),
        ],
      ),
    );
  }

  Future<bool> _placeBid(
    int listingId,
    double amount, {
    String? pawnshopId,
  }) async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) {
      if (!mounted) return false;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please login to place bids')),
      );
      return false;
    }

    setState(() => _placingBidListingIds.add(listingId));
    try {
      await _backendApiService.post(
        '/auction/listings/$listingId/bids',
        accessToken: session.accessToken,
        data: {'amount': amount},
        extraHeaders: {
          if (pawnshopId != null && pawnshopId.isNotEmpty)
            'pawnshop-id': pawnshopId,
        },
      );

      if (!mounted) return true;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Bid placed successfully'),
          backgroundColor: Colors.green,
        ),
      );
      await _loadListings();
      return true;
    } catch (e) {
      if (!mounted) return false;
      final msg = e.toString();
      final clean = msg.replaceFirst('Exception: ', '').trim();
      final localBlockMessage = _kycBidBlockMessage().trim();
      final hasKycSignal = msg.contains('KYC') || msg.contains('verification');
      final hasTosSignal = msg.contains('Auction Bidder Agreement') || msg.contains('terms');
      final displayMessage = (hasKycSignal && localBlockMessage.isNotEmpty)
          ? 'Bid blocked: $localBlockMessage'
          : hasTosSignal
              ? 'You must accept the Auction Bidder Agreement before bidding.'
              : 'Failed to place bid: $clean';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(displayMessage),
          backgroundColor: Colors.red.shade700,
        ),
      );
      return false;
    } finally {
      if (mounted) {
        setState(() => _placingBidListingIds.remove(listingId));
      }
    }
  }

  Future<void> _loadListings() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final raw = await _backendApiService.get(
        '/auction/listings?status=LIVE&limit=20',
      );
      final response = (raw is Map && raw.containsKey('data'))
          ? raw['data'] as Map<String, dynamic>
          : raw as Map<String, dynamic>;
      final items = (response['items'] as List<dynamic>? ?? const []);
      if (!mounted) return;
      setState(() {
        _listings = items
            .map((entry) => Map<String, dynamic>.from(entry as Map))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load auctions: $e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Auctions'),
        backgroundColor: Colors.transparent,
        actions: [
          IconButton(
            onPressed: _loading ? null : _loadListings,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            )
          : _listings.isEmpty
          ? const Center(child: Text('No live auctions right now.'))
          : GridView.builder(
              padding: const EdgeInsets.all(20),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                childAspectRatio: 0.75,
                mainAxisSpacing: 15,
                crossAxisSpacing: 15,
              ),
              itemCount: _listings.length,
              itemBuilder: (context, i) {
                final listing = _listings[i];
                final listingIdRaw = listing['id'];
                final listingId = listingIdRaw is num
                    ? listingIdRaw.toInt()
                    : -1;
                final isPlacingBid = _placingBidListingIds.contains(listingId);
                final images =
                    (listing['images'] as List<dynamic>? ?? const []);
                final firstImage = images.isNotEmpty
                    ? Map<String, dynamic>.from(images.first as Map)['url']
                          as String?
                    : null;
                final title = (listing['title'] as String?) ?? 'Auction Item';
                final currentBid = _asDouble(
                  _listingValue(listing, ['currentBid', 'current_bid']),
                );
                final startingPrice = _asDouble(
                  _listingValue(listing, ['startingPrice', 'starting_price']),
                );
                final displayBid = currentBid > 0 ? currentBid : startingPrice;

                return Container(
                  decoration: AppTheme.cardDecoration,
                  child: Column(
                    children: [
                      Expanded(
                        child: ClipRRect(
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(16),
                          ),
                          child: firstImage != null
                              ? Image.network(
                                  firstImage,
                                  width: double.infinity,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Icon(
                                    Icons.image_not_supported,
                                    color: AppTheme.gold.withValues(alpha: 0.3),
                                    size: 50,
                                  ),
                                )
                              : Icon(
                                  Icons.image,
                                  color: AppTheme.gold.withValues(alpha: 0.2),
                                  size: 50,
                                ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const Text(
                              'Current Bid',
                              style: TextStyle(
                                fontSize: 10,
                                color: AppTheme.textMuted,
                              ),
                            ),
                            Text(
                              '₱${displayBid.toStringAsFixed(0)}',
                              style: const TextStyle(
                                color: AppTheme.gold,
                                fontWeight: FontWeight.w700,
                                fontSize: 17,
                              ),
                            ),
                            const SizedBox(height: 8),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton(
                                onPressed: isPlacingBid
                                    ? null
                                    : () => _showBidDialog(listing),
                                child: isPlacingBid
                                    ? const SizedBox(
                                        width: 14,
                                        height: 14,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: AppTheme.gold,
                                        ),
                                      )
                                    : const Text(
                                        'Bid',
                                        style: TextStyle(
                                          color: AppTheme.gold,
                                          fontSize: 12,
                                        ),
                                      ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

// --- SCREEN 8: ACCOUNT (IMAGE_139A7A) ---
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});
  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final BackendApiService _api = BackendApiService();
  List<Map<String, dynamic>> _tickets = [];
  List<Map<String, dynamic>> _paidItems = [];
  MobileKycStatus _kycStatus = MobileKycStatus.notSubmitted;
  String? _kycRejectionReason;
  bool _kycLoading = true;
  Timer? _pollTimer;

  void _openPersonalInfo() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const PersonalInfoScreen()),
    );
  }

  void _openSecurity() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const SecuritySettingsScreen()),
    );
  }

  void _openKycVerification() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => KycVerificationPage(
          initialStatus: _kycStatus,
          rejectionReason: _kycRejectionReason,
          onStatusChanged: _loadKycStatus,
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _loadTickets();
    _loadPaidItems();
    _loadKycStatus();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _loadTickets(),
    );
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadTickets() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final raw = await _api.get(
        '/queue/my-tickets',
        accessToken: session.accessToken,
      );
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List items = payload is List ? payload : [];
      if (mounted) {
        setState(() {
          _tickets = items
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        });
      }
    } catch (_) {}
  }

  Future<void> _loadPaidItems() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      final raw = await _api.get(
        '/loans/my-history',
        accessToken: session.accessToken,
      );
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final List items = payload is List ? payload : [];
      if (mounted) {
        setState(() {
          _paidItems = items
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        });
      }
    } catch (_) {}
  }

  MobileKycStatus _mapKycStatus(String status) {
    switch (status.toUpperCase()) {
      case 'VERIFIED':
        return MobileKycStatus.verified;
      case 'PENDING':
        return MobileKycStatus.verified;
      case 'REJECTED':
        return MobileKycStatus.rejected;
      default:
        return MobileKycStatus.notSubmitted;
    }
  }

  Future<void> _loadKycStatus() async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) {
        if (!mounted) return;
        setState(() {
          _kycStatus = MobileKycStatus.notSubmitted;
          _kycRejectionReason = null;
          _kycLoading = false;
        });
        return;
      }

      final raw = await _api.get(
        '/auth/kyc/status',
        accessToken: session.accessToken,
      );
      final payload = (raw is Map && raw['data'] != null)
          ? Map<String, dynamic>.from(raw['data'] as Map)
          : Map<String, dynamic>.from(raw as Map);

      final status = (payload['kycStatus'] as String?) ?? 'NOT_SUBMITTED';
      final kyc = payload['kyc'] is Map
          ? Map<String, dynamic>.from(payload['kyc'] as Map)
          : null;

      if (!mounted) return;
      setState(() {
        _kycStatus = _mapKycStatus(status);
        _kycRejectionReason = kyc?['rejectionReason']?.toString();
        _kycLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _kycStatus = MobileKycStatus.notSubmitted;
        _kycRejectionReason = null;
        _kycLoading = false;
      });
    }
  }

  Widget _buildKycStatusCard() {
    if (_kycLoading) {
      return Container(
        margin: const EdgeInsets.only(top: 16),
        padding: const EdgeInsets.all(14),
        decoration: AppTheme.cardDecoration,
        child: const Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.gold,
              ),
            ),
            SizedBox(width: 10),
            Text('Checking verification status...'),
          ],
        ),
      );
    }

    IconData icon;
    Color accent;
    String title;
    String subtitle;
    bool actionable = false;

    switch (_kycStatus) {
      case MobileKycStatus.verified:
        icon = Icons.verified_user;
        accent = Colors.green.shade400;
        title = 'KYC Verified';
        subtitle = 'You can place bids and use full account features.';
        break;
      case MobileKycStatus.pending:
        icon = Icons.pending_actions;
        accent = Colors.orange.shade300;
        title = 'KYC Pending Review';
        subtitle = 'Your documents are under review.';
        break;
      case MobileKycStatus.rejected:
        icon = Icons.cancel_outlined;
        accent = Colors.red.shade400;
        title = 'KYC Rejected';
        subtitle = _kycRejectionReason?.isNotEmpty == true
            ? _kycRejectionReason!
            : 'Please resubmit your verification details.';
        actionable = true;
        break;
      case MobileKycStatus.notSubmitted:
        icon = Icons.verified_user_outlined;
        accent = AppTheme.gold;
        title = 'KYC Not Submitted';
        subtitle = 'Verify your identity to unlock bidding.';
        actionable = true;
        break;
    }

    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkBgSecondary,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.45)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: accent, size: 22),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.65),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (actionable) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _openKycVerification,
                icon: Icon(Icons.verified_user, size: 16, color: accent),
                label: Text(
                  'Verify Now',
                  style: TextStyle(fontSize: 12, color: accent),
                ),
                style: OutlinedButton.styleFrom(
                  side: BorderSide(color: accent.withValues(alpha: 0.45)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _cancelTicket(String ticketId, String reason) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      await _api.post(
        '/queue/my-tickets/$ticketId/cancel',
        data: {'reason': reason},
        accessToken: session.accessToken,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Ticket cancelled successfully'),
            backgroundColor: Colors.green.shade700,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
      _loadTickets();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to cancel: $e'),
            backgroundColor: Colors.red.shade700,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _showCancelDialog(String ticketId, String queueNumber) {
    String? selectedReason;
    final reasons = [
      'Changed my mind',
      'Wait time too long',
      'Wrong pawnshop branch',
      'Going to visit later',
      'Found a better option',
      'Others',
    ];
    final otherController = TextEditingController();
    bool showOtherField = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppTheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: Row(
            children: [
              Icon(Icons.cancel_outlined, color: Colors.red.shade400, size: 24),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Cancel Ticket $queueNumber',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Why are you cancelling?',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.7),
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 12),
                RadioGroup<String>(
                  groupValue: selectedReason,
                  onChanged: (val) {
                    setDialogState(() {
                      selectedReason = val;
                      showOtherField = val == 'Others';
                    });
                  },
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: reasons.map((r) {
                      return RadioListTile<String>(
                        value: r,
                        activeColor: AppTheme.gold,
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(r, style: const TextStyle(fontSize: 13)),
                      );
                    }).toList(),
                  ),
                ),
                if (showOtherField) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: otherController,
                    maxLines: 2,
                    style: const TextStyle(fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Please specify your reason...',
                      hintStyle: TextStyle(
                        color: Colors.white.withValues(alpha: 0.3),
                      ),
                      filled: true,
                      fillColor: AppTheme.darkBgSecondary,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.all(12),
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text(
                'Keep Ticket',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.6)),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red.shade700,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              onPressed: selectedReason == null
                  ? null
                  : () {
                      final reason = selectedReason == 'Others'
                          ? (otherController.text.trim().isEmpty
                                ? 'Other reason'
                                : otherController.text.trim())
                          : selectedReason!;
                      Navigator.of(ctx).pop();
                      _cancelTicket(ticketId, reason);
                    },
              child: const Text(
                'Cancel Ticket',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAccountTicketCard(Map<String, dynamic> ticket) {
    final queueNumber =
        ticket['queueNumber']?.toString() ??
        ticket['queue_number']?.toString() ??
        '---';
    final status = ticket['status']?.toString().toUpperCase() ?? 'WAITING';
    final queueType =
        ticket['queueType']?.toString() ??
        ticket['queue_type']?.toString() ??
        '';
    final pawnshop = ticket['pawnshop'];
    final pawnshopName =
        (pawnshop is Map ? pawnshop['name'] : null)?.toString() ?? 'Branch';
    final notes = ticket['notes']?.toString() ?? '';
    final estimatedWait =
        ticket['estimatedWaitMinutes'] ?? ticket['estimated_wait_minutes'];
    final counterNumber =
        ticket['counterNumber']?.toString() ??
        ticket['counter_number']?.toString();
    final ticketId = ticket['id']?.toString() ?? '';

    Color statusColor;
    IconData statusIcon;
    String statusLabel;
    bool canCancel = false;
    switch (status) {
      case 'SERVING':
        statusColor = const Color(0xFF4CAF50);
        statusIcon = Icons.play_circle_filled;
        statusLabel = 'Now Serving';
        canCancel = true;
        break;
      case 'COMPLETED':
        statusColor = Colors.grey;
        statusIcon = Icons.check_circle;
        statusLabel = 'Completed';
        break;
      case 'CANCELLED':
        statusColor = Colors.red.shade400;
        statusIcon = Icons.cancel;
        statusLabel = 'Cancelled';
        break;
      default:
        statusColor = AppTheme.gold;
        statusIcon = Icons.hourglass_top;
        statusLabel = 'Waiting';
        canCancel = true;
    }

    return GestureDetector(
      onTap: () {
        if (ticketId.isNotEmpty) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) =>
                  TicketChatScreen(ticketId: ticketId, ticket: ticket),
            ),
          );
        }
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.darkBgSecondary,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: status == 'SERVING'
                ? statusColor.withValues(alpha: 0.5)
                : Colors.white.withValues(alpha: 0.06),
            width: status == 'SERVING' ? 1.5 : 1,
          ),
        ),
        child: Column(
          children: [
            Row(
              children: [
                // Queue number badge
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 3,
                      vertical: 4,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Expanded(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              queueNumber,
                              maxLines: 1,
                              style: TextStyle(
                                color: statusColor,
                                fontSize: 14,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                        Icon(statusIcon, color: statusColor, size: 12),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              pawnshopName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              statusLabel,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: statusColor,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      if (notes.isNotEmpty)
                        Text(
                          notes,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.6),
                            fontSize: 12,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          if (queueType.isNotEmpty)
                            Text(
                              queueType.replaceAll('_', ' '),
                              style: TextStyle(
                                color: AppTheme.gold.withValues(alpha: 0.7),
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          if (status == 'WAITING' && estimatedWait != null) ...[
                            Icon(
                              Icons.access_time,
                              size: 12,
                              color: Colors.white.withValues(alpha: 0.5),
                            ),
                            Text(
                              '~$estimatedWait min',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.5),
                                fontSize: 11,
                              ),
                            ),
                          ],
                          if (status == 'SERVING' && counterNumber != null) ...[
                            Icon(
                              Icons.meeting_room,
                              size: 12,
                              color: statusColor,
                            ),
                            Text(
                              'Counter $counterNumber',
                              style: TextStyle(
                                color: statusColor,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            // Cancel button for active tickets
            if (canCancel) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _showCancelDialog(ticketId, queueNumber),
                  icon: Icon(
                    Icons.cancel_outlined,
                    size: 16,
                    color: Colors.red.shade400,
                  ),
                  label: Text(
                    'Cancel Ticket',
                    style: TextStyle(fontSize: 12, color: Colors.red.shade400),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(
                      color: Colors.red.shade400.withValues(alpha: 0.4),
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildPaidItemCard(Map<String, dynamic> item) {
    final ticketNumber = item['ticketNumber']?.toString() ?? '---';
    final itemName = item['itemName']?.toString() ?? 'Pawned Item';
    final category = item['category']?.toString() ?? '';
    final totalPaid = (item['totalPaid'] as num?)?.toDouble() ?? 0.0;
    final paidAtRaw = item['paidAt']?.toString();
    final paidAt = paidAtRaw != null ? DateTime.tryParse(paidAtRaw) : null;
    final paidAtText = paidAt != null
        ? '${paidAt.year}-${paidAt.month.toString().padLeft(2, '0')}-${paidAt.day.toString().padLeft(2, '0')}'
        : 'N/A';

    final receipt = item['receipt'] as Map<String, dynamic>?;
    final receiptNumber = receipt?['receiptNumber']?.toString();
    final receiptId = receipt?['id']?.toString();
    final pdfUrl = receipt?['pdfUrl']?.toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkBgSecondary,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.green.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: Colors.green.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.check_circle,
                  color: Colors.green.shade400,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      itemName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Ticket #$ticketNumber${category.isNotEmpty ? ' • $category' : ''}',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.55),
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Paid on $paidAtText',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.45),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '₱${totalPaid.toStringAsFixed(0)}',
                style: const TextStyle(
                  color: AppTheme.gold,
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
            ],
          ),
          if (receiptId != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(
                  Icons.receipt_long,
                  size: 14,
                  color: AppTheme.gold.withValues(alpha: 0.7),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    receiptNumber != null
                        ? 'Receipt #$receiptNumber'
                        : 'Receipt available',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppTheme.gold.withValues(alpha: 0.7),
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () => _viewReceipt(receiptId, pdfUrl),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: AppTheme.gold.withValues(alpha: 0.3),
                      ),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'View Receipt',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppTheme.gold,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _viewReceipt(String receiptId, String? directUrl) async {
    try {
      String? pdfUrl = directUrl;

      if (pdfUrl == null || pdfUrl.isEmpty) {
        final session = Supabase.instance.client.auth.currentSession;
        if (session == null) return;
        final response = await _api.get(
          '/receipts/$receiptId/pdf',
          accessToken: session.accessToken,
        );
        final payload = response is Map && response.containsKey('data')
            ? response['data'] as Map<String, dynamic>
            : response as Map<String, dynamic>;
        pdfUrl = payload['pdfUrl']?.toString();
      }

      if (pdfUrl == null || pdfUrl.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Receipt not available.')),
        );
        return;
      }

      final uri = Uri.tryParse(pdfUrl);
      if (uri != null && await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open receipt.')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to open receipt.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final activeTickets = _tickets.where((t) {
      final s = t['status']?.toString().toUpperCase();
      return s == 'WAITING' || s == 'SERVING';
    }).toList();

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 40),
          Center(
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.gold.withValues(alpha: 0.5)),
              ),
              child: const CircleAvatar(
                radius: 46,
                backgroundColor: AppTheme.gold,
                child: Icon(Icons.person, size: 46, color: Colors.black),
              ),
            ),
          ),
          const SizedBox(height: 15),
          Center(
            child: Text(
              user?.userMetadata?['fullName'] as String? ??
                  user?.email ??
                  'User',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
            ),
          ),
          Center(
            child: Text(
              user?.email ?? 'No email',
              style: const TextStyle(color: AppTheme.gold),
            ),
          ),
          _buildKycStatusCard(),
          // ── Active Tickets ──
          if (activeTickets.isNotEmpty) ...[
            const SizedBox(height: 28),
            Row(
              children: [
                const Text('🎫', style: TextStyle(fontSize: 18)),
                const SizedBox(width: 8),
                const Text(
                  'My Active Tickets',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.gold.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${activeTickets.length}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.gold,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...activeTickets.map((t) => _buildAccountTicketCard(t)),
          ],

          const SizedBox(height: 28),
          Container(
            decoration: AppTheme.cardDecoration,
            child: Column(
              children: [
                _settingTile(
                  Icons.history,
                  "Ticket History",
                  onTap: _showTicketHistorySheet,
                ),
                _settingTile(
                  Icons.receipt_long,
                  "Paid Items",
                  onTap: _showPaidItemsSheet,
                ),
                _settingTile(
                  Icons.person_outline,
                  "Personal Info",
                  onTap: _openPersonalInfo,
                ),
                _settingTile(Icons.security, "Security", onTap: _openSecurity),
                _settingTile(
                  Icons.logout,
                  "Logout",
                  isLast: true,
                  onTap: () {
                    context.read<AuthBloc>().add(const LogoutEvent());
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 30),
        ],
      ),
    );
  }

  void _showPaidItemsSheet() {
    final paidItems = List<Map<String, dynamic>>.from(_paidItems);

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      isScrollControlled: true,
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.65,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (ctx, scrollCtrl) {
            return Column(
              children: [
                const SizedBox(height: 10),
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.receipt_long,
                        color: AppTheme.gold,
                        size: 22,
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Paid Items / Transactions',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (paidItems.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.green.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '${paidItems.length}',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.green.shade300,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const Divider(height: 1, color: Colors.white12),
                Expanded(
                  child: paidItems.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.payments_outlined,
                                size: 48,
                                color: Colors.white.withValues(alpha: 0.2),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'No paid items yet',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.4),
                                  fontSize: 14,
                                ),
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          controller: scrollCtrl,
                          padding: const EdgeInsets.all(16),
                          itemCount: paidItems.length,
                          itemBuilder: (ctx, i) =>
                              _buildPaidItemCard(paidItems[i]),
                        ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _showTicketHistorySheet() async {
    await _loadTickets();
    if (!mounted) return;
    final history = _tickets.where((t) {
      final s = t['status']?.toString().toUpperCase();
      return s == 'COMPLETED' || s == 'CANCELLED' || s == 'NO_SHOW';
    }).toList();

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      isScrollControlled: true,
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.65,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (ctx, scrollCtrl) {
            return Column(
              children: [
                const SizedBox(height: 10),
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Row(
                    children: [
                      const Icon(Icons.history, color: AppTheme.gold, size: 22),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Ticket History',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (history.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.gold.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '${history.length}',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.gold,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const Divider(height: 1, color: Colors.white12),
                Expanded(
                  child: history.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.receipt_long,
                                size: 48,
                                color: Colors.white.withValues(alpha: 0.2),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'No ticket history yet',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.4),
                                  fontSize: 14,
                                ),
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          controller: scrollCtrl,
                          padding: const EdgeInsets.all(16),
                          itemCount: history.length,
                          itemBuilder: (ctx, i) =>
                              _buildAccountTicketCard(history[i]),
                        ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _settingTile(
    IconData icon,
    String title, {
    bool isLast = false,
    VoidCallback? onTap,
  }) => ListTile(
    leading: Icon(icon, color: AppTheme.gold),
    title: Text(title),
    onTap: onTap,
    trailing: const Icon(Icons.chevron_right, size: 18),
  );
}

class PersonalInfoScreen extends StatefulWidget {
  const PersonalInfoScreen({super.key});

  @override
  State<PersonalInfoScreen> createState() => _PersonalInfoScreenState();
}

class _PersonalInfoScreenState extends State<PersonalInfoScreen> {
  final BackendApiService _api = BackendApiService();
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _phoneCtrl = TextEditingController();
  final TextEditingController _addressCtrl = TextEditingController();
  String _kycStatus = 'NOT_SUBMITTED';
  Map<String, dynamic>? _kycDetails;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    Map<String, dynamic> profile = <String, dynamic>{};
    String kycStatus = 'NOT_SUBMITTED';
    Map<String, dynamic>? kycDetails;
    final token = Supabase.instance.client.auth.currentSession?.accessToken;

    try {
      final raw = await _api.get('/profile/me', accessToken: token);
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      profile = payload is Map
          ? Map<String, dynamic>.from(payload)
          : <String, dynamic>{};
    } catch (_) {
      // Fall back to current auth metadata if profile endpoint fails.
      final user = Supabase.instance.client.auth.currentUser;
      profile = {
        'fullName': (user?.userMetadata?['fullName'] ?? '').toString(),
      };
    }

    try {
      final rawKyc = await _api.get('/auth/kyc/status', accessToken: token);
      final payload = (rawKyc is Map && rawKyc['data'] != null)
          ? rawKyc['data']
          : rawKyc;

      if (payload is Map) {
        final mapPayload = Map<String, dynamic>.from(payload);
        kycStatus = (mapPayload['kycStatus'] ?? 'NOT_SUBMITTED')
            .toString()
            .toUpperCase();
        final kycRaw = mapPayload['kyc'];
        if (kycRaw is Map) {
          kycDetails = Map<String, dynamic>.from(kycRaw);
        }
      }
    } catch (_) {
      kycStatus = 'NOT_SUBMITTED';
      kycDetails = null;
    } finally {
      if (mounted) {
        setState(() {
          _nameCtrl.text = (profile['fullName'] ?? '').toString();
          _phoneCtrl.text = (profile['phoneNumber'] ?? '').toString();
          _addressCtrl.text = (profile['address'] ?? '').toString();
          _kycStatus = kycStatus;
          _kycDetails = kycDetails;
          _loading = false;
        });
      }
    }
  }

  String _kycStatusLabel() {
    switch (_kycStatus) {
      case 'VERIFIED':
        return 'Verified';
      case 'PENDING':
        return 'Pending Review';
      case 'REJECTED':
        return 'Rejected';
      default:
        return 'Not Submitted';
    }
  }

  Color _kycStatusColor() {
    switch (_kycStatus) {
      case 'VERIFIED':
        return Colors.green;
      case 'PENDING':
        return Colors.amber.shade700;
      case 'REJECTED':
        return Colors.red.shade700;
      default:
        return AppTheme.textMuted;
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      await _api.patch(
        '/profile/me',
        accessToken: token,
        data: {
          'fullName': _nameCtrl.text.trim(),
          'phoneNumber': _phoneCtrl.text.trim(),
          'address': _addressCtrl.text.trim(),
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Personal info updated successfully')),
      );
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to save profile: $e'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _addressCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Personal Info'),
        actions: [
          TextButton(
            onPressed: _loading || _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.gold,
                    ),
                  )
                : const Text('Save', style: TextStyle(color: AppTheme.gold)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.gold))
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  TextFormField(
                    controller: _nameCtrl,
                    decoration: AppTheme.inputDecoration('Full name'),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _phoneCtrl,
                    decoration: AppTheme.inputDecoration('Phone number'),
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _addressCtrl,
                    decoration: AppTheme.inputDecoration('Address'),
                    minLines: 2,
                    maxLines: 3,
                  ),
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.08),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'KYC Details',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'Status: ${_kycStatusLabel()}',
                          style: TextStyle(
                            color: _kycStatusColor(),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Verified Name: ${(_kycDetails?['fullName'] ?? 'Not provided').toString()}',
                          style: const TextStyle(color: AppTheme.textMuted),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'ID Type: ${(_kycDetails?['idType'] ?? 'Not provided').toString()}',
                          style: const TextStyle(color: AppTheme.textMuted),
                        ),
                        if (_kycStatus == 'REJECTED' &&
                            (_kycDetails?['rejectionReason']
                                    ?.toString()
                                    .trim()
                                    .isNotEmpty ??
                                false)) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Reason: ${_kycDetails?['rejectionReason']}',
                            style: TextStyle(color: Colors.red.shade700),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class SecuritySettingsScreen extends StatefulWidget {
  const SecuritySettingsScreen({super.key});

  @override
  State<SecuritySettingsScreen> createState() => _SecuritySettingsScreenState();
}

class _SecuritySettingsScreenState extends State<SecuritySettingsScreen> {
  final BackendApiService _api = BackendApiService();
  final TextEditingController _passwordCtrl = TextEditingController();
  bool _saving = false;
  List<Map<String, dynamic>> _logs = [];
  bool _loadingLogs = true;

  @override
  void initState() {
    super.initState();
    _loadLogs();
  }

  Future<void> _loadLogs() async {
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      final raw = await _api.get('/security/activity-log', accessToken: token);
      final payload = (raw is Map && raw['data'] != null) ? raw['data'] : raw;
      final list = payload is List ? payload : [];
      if (!mounted) return;
      setState(() {
        _logs = list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loadingLogs = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingLogs = false);
    }
  }

  Future<void> _changePassword() async {
    final password = _passwordCtrl.text.trim();
    if (password.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Password must be at least 8 characters'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      await _api.post(
        '/security/change-password',
        accessToken: token,
        data: {'newPassword': password},
      );
      if (!mounted) return;
      _passwordCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password changed successfully')),
      );
      _loadLogs();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to change password: $e'),
          backgroundColor: Colors.red.shade700,
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _passwordCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Security')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            decoration: AppTheme.cardDecoration,
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Change Password',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _passwordCtrl,
                  obscureText: true,
                  decoration: AppTheme.inputDecoration(
                    'New password (min 8 chars, mixed case + number)',
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _changePassword,
                    child: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.black,
                            ),
                          )
                        : const Text('Update Password'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            decoration: AppTheme.cardDecoration,
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Security Activity',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                if (_loadingLogs)
                  const Center(
                    child: CircularProgressIndicator(color: AppTheme.gold),
                  )
                else if (_logs.isEmpty)
                  const Text(
                    'No security logs yet',
                    style: TextStyle(color: AppTheme.textMuted),
                  )
                else
                  ..._logs
                      .take(8)
                      .map(
                        (log) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            (log['success'] == false)
                                ? Icons.error_outline
                                : Icons.check_circle_outline,
                            color: (log['success'] == false)
                                ? Colors.red.shade400
                                : AppTheme.gold,
                            size: 18,
                          ),
                          title: Text(
                            (log['action'] ?? 'UNKNOWN').toString(),
                            style: const TextStyle(fontSize: 13),
                          ),
                          subtitle: Text(
                            (log['createdAt'] ?? '').toString(),
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppTheme.textMuted,
                            ),
                          ),
                        ),
                      ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// TICKET CHAT SCREEN
// ============================================================================

class TicketChatScreen extends StatefulWidget {
  final String ticketId;
  final Map<String, dynamic> ticket;
  const TicketChatScreen({
    super.key,
    required this.ticketId,
    required this.ticket,
  });

  @override
  State<TicketChatScreen> createState() => _TicketChatScreenState();
}

class _TicketChatScreenState extends State<TicketChatScreen> {
  final BackendApiService _api = BackendApiService();
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 4),
      (_) => _loadMessages(),
    );
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages() async {
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      final raw = await _api.get(
        '/queue/my-tickets/${widget.ticketId}/messages',
        accessToken: token,
      );
      final payload = (raw is Map && raw.containsKey('data'))
          ? raw['data']
          : raw;
      if (payload is List && mounted) {
        final newMessages = payload
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        final hadMessages = _messages.length;
        setState(() {
          _messages = newMessages;
          _loading = false;
        });
        if (newMessages.length > hadMessages) {
          _scrollToBottom();
        }
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendMessage() async {
    final text = _msgController.text.trim();
    if (text.isEmpty) return;
    _msgController.clear();
    try {
      final token = Supabase.instance.client.auth.currentSession?.accessToken;
      await _api.post(
        '/queue/my-tickets/${widget.ticketId}/messages',
        data: {'message': text},
        accessToken: token,
      );
      await _loadMessages();
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to send message: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final queueNumber =
        widget.ticket['queueNumber']?.toString() ??
        widget.ticket['queue_number']?.toString() ??
        '---';
    final status = widget.ticket['status']?.toString() ?? '';
    final pawnshop = widget.ticket['pawnshop'];
    final pawnshopName =
        (pawnshop is Map ? pawnshop['name'] : null)?.toString() ?? 'Pawnshop';

    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      appBar: AppBar(
        backgroundColor: AppTheme.darkBgSecondary,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.gold.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                queueNumber,
                style: const TextStyle(
                  color: AppTheme.gold,
                  fontWeight: FontWeight.w800,
                  fontSize: 14,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pawnshopName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    'Status: $status',
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.white.withValues(alpha: 0.5),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          // Messages list
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation(AppTheme.gold),
                    ),
                  )
                : _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.chat_bubble_outline,
                          size: 48,
                          color: Colors.white.withValues(alpha: 0.15),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'No messages yet',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.4),
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Start a conversation with the pawnshop',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.25),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final msg = _messages[index];
                      final isMe =
                          msg['senderRole'] == 'CUSTOMER' ||
                          msg['sender_role'] == 'CUSTOMER';
                      final text = msg['message']?.toString() ?? '';
                      final createdAt =
                          msg['createdAt']?.toString() ??
                          msg['created_at']?.toString() ??
                          '';
                      String timeLabel = '';
                      if (createdAt.isNotEmpty) {
                        try {
                          final dt = DateTime.parse(createdAt).toLocal();
                          timeLabel =
                              '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
                        } catch (_) {}
                      }

                      return Align(
                        alignment: isMe
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.of(context).size.width * 0.75,
                          ),
                          decoration: BoxDecoration(
                            color: isMe
                                ? AppTheme.gold.withValues(alpha: 0.18)
                                : AppTheme.darkBgSecondary,
                            borderRadius: BorderRadius.only(
                              topLeft: const Radius.circular(16),
                              topRight: const Radius.circular(16),
                              bottomLeft: isMe
                                  ? const Radius.circular(16)
                                  : const Radius.circular(4),
                              bottomRight: isMe
                                  ? const Radius.circular(4)
                                  : const Radius.circular(16),
                            ),
                            border: Border.all(
                              color: isMe
                                  ? AppTheme.gold.withValues(alpha: 0.3)
                                  : Colors.white.withValues(alpha: 0.06),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: isMe
                                ? CrossAxisAlignment.end
                                : CrossAxisAlignment.start,
                            children: [
                              if (!isMe)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 4),
                                  child: Text(
                                    'Staff',
                                    style: TextStyle(
                                      color: AppTheme.gold.withValues(
                                        alpha: 0.7,
                                      ),
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              Text(
                                text,
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.white,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                timeLabel,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: Colors.white.withValues(alpha: 0.35),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          // Input bar
          Container(
            padding: EdgeInsets.only(
              left: 16,
              right: 8,
              top: 8,
              bottom: MediaQuery.of(context).padding.bottom + 8,
            ),
            decoration: BoxDecoration(
              color: AppTheme.darkBgSecondary,
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _msgController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      hintStyle: TextStyle(
                        color: Colors.white.withValues(alpha: 0.3),
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(
                          color: Colors.white.withValues(alpha: 0.1),
                        ),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(
                          color: Colors.white.withValues(alpha: 0.1),
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: const BorderSide(color: AppTheme.gold),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      filled: true,
                      fillColor: AppTheme.darkBg,
                    ),
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.gold,
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.send, color: Colors.black, size: 20),
                    onPressed: _sendMessage,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// --- UTILITIES ---
class GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    var paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.03)
      ..strokeWidth = 1.0;
    for (double i = 0; i <= size.width; i += 30) {
      canvas.drawLine(Offset(i, 0), Offset(i, size.height), paint);
    }
    for (double i = 0; i <= size.height; i += 30) {
      canvas.drawLine(Offset(0, i), Offset(size.width, i), paint);
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
