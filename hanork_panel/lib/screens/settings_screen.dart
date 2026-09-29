import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/panel_provider.dart';
import '../widgets/stat_card.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();
    final auth = context.watch<AuthProvider>();
    final s = panel.settings ?? {};

    return RefreshIndicator(
      onRefresh: () => panel.loadSettings(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Configurações (somente leitura)', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text(
            'A automação do bot permanece no servidor. Este app apenas consulta e monitora.',
            style: TextStyle(color: Colors.white54),
          ),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                _row('Servidor', auth.baseUrl),
                _row('Bot', '@${s['botUsername'] ?? '—'}'),
                _row('Versão Hanork', '${s['version'] ?? '—'}'),
                _row('Ambiente', '${s['nodeEnv'] ?? '—'}'),
                _row('Porta HTTP', '${s['port'] ?? '—'}'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text('Módulos', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _chip('Zero Divu WA', s['zeroDivuEnabled'] == true),
              _chip('Dual WA', s['waDualEnabled'] == true),
              _chip('Orquestrador', s['campaignOrchestrator'] == true),
              _chip('SMM', s['smmEnabled'] == true),
              _chip('Mirror chat WA', s['statusMirrorToChat'] == true),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: () => auth.logout(),
            icon: const Icon(Icons.logout),
            label: const Text('Sair da conta'),
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
          ),
        ],
      ),
    );
  }

  Widget _row(String k, String v) {
    return ListTile(title: Text(k), trailing: Text(v, style: const TextStyle(color: Colors.white70)));
  }

  Widget _chip(String label, bool on) {
    return Chip(
      label: Text(label),
      avatar: Icon(on ? Icons.check_circle : Icons.cancel, size: 16, color: on ? Colors.green : Colors.grey),
    );
  }
}
