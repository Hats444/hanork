import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/panel_provider.dart';
import 'dashboard_screen.dart';
import 'logs_screen.dart';
import 'notifications_screen.dart';
import 'orders_screen.dart';
import 'settings_screen.dart';
import 'stats_screen.dart';
import 'users_screen.dart';

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _index = 0;

  static const _tabs = [
    (Icons.dashboard_outlined, 'Início'),
    (Icons.receipt_long_outlined, 'Pedidos'),
    (Icons.bar_chart_outlined, 'Stats'),
    (Icons.people_outline, 'Usuários'),
    (Icons.notifications_outlined, 'Alertas'),
    (Icons.terminal_outlined, 'Logs'),
    (Icons.settings_outlined, 'Config'),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PanelProvider>().refreshAll();
    });
  }

  Widget _page(int i) {
    switch (i) {
      case 0:
        return const DashboardScreen();
      case 1:
        return const OrdersScreen();
      case 2:
        return const StatsScreen();
      case 3:
        return const UsersScreen();
      case 4:
        return const NotificationsScreen();
      case 5:
        return const LogsScreen();
      case 6:
        return const SettingsScreen();
      default:
        return const DashboardScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final wide = MediaQuery.sizeOf(context).width >= 900;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hanork Panel'),
        actions: [
          if (auth.username != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Center(
                child: Text(auth.username!, style: const TextStyle(color: Colors.white54, fontSize: 13)),
              ),
            ),
          IconButton(
            tooltip: 'Atualizar',
            onPressed: () => context.read<PanelProvider>().refreshAll(),
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sair',
            onPressed: () => auth.logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Row(
        children: [
          if (wide)
            NavigationRail(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final t in _tabs)
                  NavigationRailDestination(icon: Icon(t.$1), label: Text(t.$2)),
              ],
            ),
          Expanded(child: _page(_index)),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              destinations: [
                for (final t in _tabs)
                  NavigationDestination(icon: Icon(t.$1), label: t.$2),
              ],
            ),
    );
  }
}
