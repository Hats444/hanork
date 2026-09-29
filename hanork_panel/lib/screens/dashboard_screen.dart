import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();
    if (panel.loading && panel.home == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final kpis = panel.home?['kpis'] as Map<String, dynamic>? ?? {};
    final revenue = kpis['revenue'] as Map<String, dynamic>? ?? {};
    final orders = kpis['orders'] as Map<String, dynamic>? ?? {};
    final users = kpis['users'] as Map<String, dynamic>? ?? {};
    final smm = panel.home?['smmBalance'] as Map<String, dynamic>?;
    final ops = panel.home?['ops'] as Map<String, dynamic>? ?? {};
    final health = ops['health'] as Map<String, dynamic>? ?? {};
    final wa = ops['whatsapp'] as Map<String, dynamic>? ?? {};

    return RefreshIndicator(
      onRefresh: () => panel.loadHome(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (panel.error != null) ErrorBanner(message: panel.error!),
          Text('Visão geral', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              SizedBox(
                width: 180,
                child: StatCard(label: 'Receita hoje', value: fmtMoney(revenue['today']), color: const Color(0xFF4ADE80)),
              ),
              SizedBox(
                width: 180,
                child: StatCard(label: 'Receita mês', value: fmtMoney(revenue['month']), color: const Color(0xFF4ADE80)),
              ),
              SizedBox(
                width: 180,
                child: StatCard(
                  label: 'Saldo SMM',
                  value: smm?['balance'] != null ? fmtMoney(smm!['balance']) : '—',
                  subtitle: smm?['level']?.toString(),
                  color: smm?['level'] == 'critical'
                      ? Colors.redAccent
                      : smm?['level'] == 'warning'
                          ? Colors.amber
                          : const Color(0xFF60A5FA),
                ),
              ),
              SizedBox(
                width: 180,
                child: StatCard(label: 'Pedidos pendentes', value: '${orders['pending'] ?? 0}', color: Colors.amber),
              ),
              SizedBox(
                width: 180,
                child: StatCard(label: 'Usuários', value: '${users['total'] ?? 0}', color: const Color(0xFF60A5FA)),
              ),
              SizedBox(
                width: 180,
                child: StatCard(
                  label: 'WhatsApp',
                  value: wa['online'] == true ? 'Online' : 'Offline',
                  subtitle: wa['phone']?.toString(),
                  color: wa['online'] == true ? const Color(0xFF4ADE80) : Colors.redAccent,
                ),
              ),
              SizedBox(
                width: 180,
                child: StatCard(
                  label: 'Sistema',
                  value: health['healthy'] == true ? 'Saudável' : 'Atenção',
                  subtitle: 'Uptime ${((panel.home?['uptimeSec'] as num?) ?? 0) ~/ 60} min',
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text('Alertas recentes', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if ((panel.alerts).isEmpty)
            const EmptyState(message: 'Nenhum alerta recente')
          else
            ...panel.alerts.take(8).map((a) {
              final m = a as Map<String, dynamic>;
              return Card(
                child: ListTile(
                  leading: Icon(
                    m['channel'] == 'wa' ? Icons.phone_android : Icons.telegram,
                    color: m['kind'] == 'fail' ? Colors.redAccent : Colors.amber,
                  ),
                  title: Text('${m['channel']?.toString().toUpperCase()} · ${m['kind']}'),
                  subtitle: Text('${m['detail'] ?? m['target'] ?? ''}'),
                  dense: true,
                ),
              );
            }),
        ],
      ),
    );
  }
}
