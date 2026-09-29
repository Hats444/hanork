import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _search,
                  decoration: const InputDecoration(
                    hintText: 'Buscar username ou ID…',
                    prefixIcon: Icon(Icons.search),
                  ),
                  onSubmitted: (q) => panel.loadUsers(page: 1, q: q),
                ),
              ),
              IconButton(
                onPressed: () => panel.loadUsers(page: 1, q: _search.text),
                icon: const Icon(Icons.search),
              ),
            ],
          ),
        ),
        if (panel.error != null)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: ErrorBanner(message: panel.error!)),
        Expanded(
          child: panel.users.isEmpty
              ? const EmptyState(message: 'Nenhum usuário')
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: panel.users.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final u = panel.users[i] as Map<String, dynamic>;
                    return Card(
                      child: ListTile(
                        title: Text('${u['first_name'] ?? ''} ${u['last_name'] ?? ''}'.trim()),
                        subtitle: Text(
                          'TG ${u['telegram_id']} · ${u['username'] != null ? '@${u['username']}' : 'sem @'}\n'
                          '${u['orders_count'] ?? 0} pedidos · ${fmtMoney(u['total_spent'])}',
                        ),
                        isThreeLine: true,
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
