import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class LogsScreen extends StatelessWidget {
  const LogsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();

    return RefreshIndicator(
      onRefresh: () => panel.loadLogs(),
      child: panel.logs.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 120),
                EmptyState(message: 'Sem logs operacionais'),
              ],
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: panel.logs.length.clamp(0, 100),
              separatorBuilder: (_, __) => const SizedBox(height: 6),
              itemBuilder: (context, i) {
                final e = panel.logs[i] as Map<String, dynamic>;
                return Card(
                  child: ListTile(
                    dense: true,
                    leading: Icon(
                      e['channel'] == 'wa' ? Icons.phone_android : Icons.terminal,
                      size: 18,
                      color: Colors.white54,
                    ),
                    title: Text(
                      '${e['kind'] ?? 'event'} · ${e['target'] ?? ''}',
                      style: const TextStyle(fontSize: 13),
                    ),
                    subtitle: Text(
                      '${e['detail'] ?? ''}\n${fmtTs(e['ts'])}',
                      style: const TextStyle(fontSize: 11, color: Colors.white54),
                    ),
                    isThreeLine: true,
                  ),
                );
              },
            ),
    );
  }
}
