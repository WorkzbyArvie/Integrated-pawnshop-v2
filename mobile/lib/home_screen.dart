import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app_theme.dart';

/// Home screen with navigation to other screens
/// Kept as-is from the original implementation
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;
  final List<Widget> _screens = [
    const HomePageContent(),
    const LoansScreen(),
    const AuctionScreen(),
    const AccountScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_selectedIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        type: BottomNavigationBarType.fixed,
        backgroundColor: AppTheme.darkBg,
        selectedItemColor: AppTheme.gold,
        unselectedItemColor: AppTheme.textMuted,
        onTap: (i) => setState(() => _selectedIndex = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.map_outlined), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.receipt_long_outlined), label: 'Loans'),
          BottomNavigationBarItem(icon: Icon(Icons.gavel_rounded), label: 'Auction'),
          BottomNavigationBarItem(icon: Icon(Icons.person_outline), label: 'Account'),
        ],
      ),
    );
  }
}

class HomePageContent extends StatelessWidget {
  const HomePageContent({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          color: AppTheme.darkBg,
          child: CustomPaint(painter: GridPainter(), size: Size.infinite),
        ),
        const Center(
          child: Icon(Icons.location_on, color: AppTheme.gold, size: 48),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              decoration: AppTheme.inputDecoration("Search premium shops...")
                  .copyWith(
                      prefixIcon: const Icon(Icons.search, color: AppTheme.gold)),
            ),
          ),
        ),
        DraggableScrollableSheet(
          initialChildSize: 0.4,
          minChildSize: 0.2,
          maxChildSize: 0.8,
          builder: (context, controller) => Container(
            decoration: const BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
            ),
            child: ListView(
              controller: controller,
              padding: const EdgeInsets.all(24),
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white12,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  "Nearby Shops",
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                _shopItem(context, "Golden Pawn Shop", "0.5 km"),
                _shopItem(context, "City Pawn Center", "1.2 km"),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _shopItem(BuildContext context, String name, String dist) => ListTile(
    onTap: () => Navigator.push(
      context,
      MaterialPageRoute(builder: (c) => const PawnTicketScreen()),
    ),
    title: Text(name),
    subtitle: Text(dist, style: const TextStyle(color: AppTheme.textMuted)),
    trailing: const Icon(Icons.chevron_right, color: AppTheme.gold),
  );
}

class PawnTicketScreen extends StatefulWidget {
  const PawnTicketScreen({super.key});

  @override
  State<PawnTicketScreen> createState() => _PawnTicketScreenState();
}

class _PawnTicketScreenState extends State<PawnTicketScreen> {
  final _formKey = GlobalKey<FormState>();
  String? _category;
  final List<String> _categories = [
    'Jewelry',
    'Electronics',
    'Watches',
    'Musical Instruments',
    'Others'
  ];

  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _valCtrl = TextEditingController();
  bool _isLoading = false;

  Future<void> _submitToSupabase() async {
    if (!_formKey.currentState!.validate() || _category == null) return;

    setState(() => _isLoading = true);
    try {
      await Supabase.instance.client.from('pawn_tickets').insert({
        'item_name': _nameCtrl.text,
        'category': _category,
        'description': _descCtrl.text,
        'estimated_value': double.tryParse(_valCtrl.text) ?? 0.0,
        'status': 'Pending',
      });
      if (mounted) Navigator.pop(context);
    } catch (e) {
      debugPrint("Upload Error: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Golden Pawn Shop"),
        backgroundColor: Colors.transparent,
      ),
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("Submit Pawn Ticket",
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 25),
              _label("Item Name"),
              TextFormField(
                controller: _nameCtrl,
                decoration: AppTheme.inputDecoration("e.g. Rolex Submariner"),
              ),
              const SizedBox(height: 20),
              _label("Category"),
              DropdownButtonFormField<String>(
                dropdownColor: AppTheme.surface,
                decoration: AppTheme.inputDecoration("Select Category"),
                items: _categories
                    .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                    .toList(),
                onChanged: (v) => setState(() => _category = v),
              ),
              const SizedBox(height: 20),
              _label("Description"),
              TextFormField(
                controller: _descCtrl,
                maxLines: 3,
                decoration: AppTheme.inputDecoration("Details..."),
              ),
              const SizedBox(height: 20),
              _label("Estimated Value (₱)"),
              TextFormField(
                controller: _valCtrl,
                keyboardType: TextInputType.number,
                decoration: AppTheme.inputDecoration("0.00"),
              ),
              const SizedBox(height: 40),
              SizedBox(
                width: double.infinity,
                height: 55,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.gold,
                    foregroundColor: Colors.black,
                  ),
                  onPressed: _isLoading ? null : _submitToSupabase,
                  child: _isLoading
                      ? const CircularProgressIndicator(color: Colors.black)
                      : const Text("SUBMIT TICKET",
                          style: TextStyle(fontWeight: FontWeight.bold)),
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
    child: Text(text,
        style:
            const TextStyle(color: AppTheme.gold, fontSize: 12, fontWeight: FontWeight.w500)),
  );
}

class LoansScreen extends StatelessWidget {
  const LoansScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(24, 60, 24, 30),
            decoration: const BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(30)),
            ),
            child: const Column(children: [
              Text("Total Asset Value",
                  style: TextStyle(color: AppTheme.textMuted)),
              Text("₱12,450",
                  style: TextStyle(
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.gold,
                  )),
            ]),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const Text("Active Loans",
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 15),
                _loanCard("Gold Necklace 18K", "1,200", "16 days left", 0.4),
                _loanCard("Rolex Submariner", "8,500", "2 days left", 0.9),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _loanCard(String title, String val, String time, double progress) =>
      Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
        ),
        child: Column(children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title),
              Text("₱$val", style: const TextStyle(color: AppTheme.gold))
            ],
          ),
          const SizedBox(height: 10),
          LinearProgressIndicator(
            value: progress,
            color: AppTheme.gold,
            backgroundColor: Colors.white10,
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(time,
                  style: const TextStyle(
                      fontSize: 12, color: AppTheme.textMuted)),
              const Text("Pay Now",
                  style: TextStyle(color: AppTheme.gold, fontSize: 12))
            ],
          ),
        ]),
      );
}

class AuctionScreen extends StatelessWidget {
  const AuctionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Live Auctions"),
        backgroundColor: Colors.transparent,
      ),
      body: GridView.builder(
        padding: const EdgeInsets.all(20),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 0.75,
          mainAxisSpacing: 15,
          crossAxisSpacing: 15,
        ),
        itemCount: 4,
        itemBuilder: (context, i) => Container(
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(children: [
            Expanded(
              child: Icon(Icons.image,
                  color: AppTheme.gold.withValues(alpha: 0.2), size: 50),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text("Diamond Ring",
                      style: TextStyle(fontWeight: FontWeight.bold)),
                  const Text("Current Bid",
                      style:
                          TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                  const Text("\$2,400",
                      style: TextStyle(
                        color: AppTheme.gold,
                        fontWeight: FontWeight.bold,
                      )),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {},
                      child: const Text("Bid",
                          style: TextStyle(
                              color: AppTheme.gold, fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 40),
          const Center(
            child: CircleAvatar(
              radius: 50,
              backgroundColor: AppTheme.gold,
              child: Icon(Icons.person, size: 50, color: Colors.black),
            ),
          ),
          const SizedBox(height: 15),
          const Center(
            child: Text("John Doe",
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          ),
          const Center(
            child: Text("Premium Member",
                style: TextStyle(color: AppTheme.gold)),
          ),
          const SizedBox(height: 40),
          _settingTile(Icons.person_outline, "Personal Info"),
          _settingTile(Icons.security, "Security"),
          _settingTile(Icons.payment, "Payment Methods"),
          _settingTile(Icons.logout, "Logout", isLast: true),
        ],
      ),
    );
  }

  Widget _settingTile(IconData icon, String title, {bool isLast = false}) =>
      ListTile(
        leading: Icon(icon, color: AppTheme.gold),
        title: Text(title),
        trailing: const Icon(Icons.chevron_right, size: 16),
      );
}

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
