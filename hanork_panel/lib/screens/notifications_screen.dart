import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();

    return RefreshIndicator(
      onRefresh: () => panel.loadLogs(),
      child: panel.alerts.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 120),
                EmptyState(message: 'Nenhuma notificação / alerta'),
              ],
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: panel.alerts.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final a = panel.alerts[i] as Map<String, dynamic>;
                final kind = a['kind']?.toString() ?? 'info';
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: kind == 'fail'
                          ? Colors.red.withValues(alpha: 0.2)
                          : Colors.amber.withValues(alpha: 0.2),
                      child: Icon(
                        a['channel'] == 'wa' ? Icons.phone_android : Icons.telegram,
                        size: 20,
                      ),
                    ),
                    title: Text('${a['channel']?.toString().toUpperCase()} · $kind'),
                    subtitle: Text('${a['detail'] ?? a['target'] ?? ''}\n${fmtTs(a['at'])}'),
                    isThreeLine: true,
                  ),
                );
              },
            ),
    );
  }
}
