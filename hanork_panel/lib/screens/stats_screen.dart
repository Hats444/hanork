import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class StatsScreen extends StatelessWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();
    final stats = panel.stats;
    final revenue = stats?['revenue'] as Map<String, dynamic>? ?? {};
    final counts = stats?['counts'] as Map<String, dynamic>? ?? {};

    return RefreshIndicator(
      onRefresh: () async {
        await panel.loadStats();
        await panel.loadSalesChart();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (panel.error != null) ErrorBanner(message: panel.error!),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              SizedBox(width: 160, child: StatCard(label: 'Hoje', value: fmtMoney(revenue['today']))),
              SizedBox(width: 160, child: StatCard(label: 'Semana', value: fmtMoney(revenue['week']))),
              SizedBox(width: 160, child: StatCard(label: 'Mês', value: fmtMoney(revenue['month']))),
              SizedBox(width: 160, child: StatCard(label: 'Usuários', value: '${counts['users'] ?? 0}')),
              SizedBox(width: 160, child: StatCard(label: 'Pedidos pagos', value: '${counts['orders_paid'] ?? 0}')),
              SizedBox(width: 160, child: StatCard(label: 'Grupos TG', value: '${counts['groups'] ?? 0}')),
            ],
          ),
          const SizedBox(height: 24),
          Text('Vendas (${panel.salesChart.length} dias)', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (panel.salesChart.isEmpty)
            const EmptyState(message: 'Sem dados de vendas')
          else
            ...panel.salesChart.reversed.take(30).map((row) {
              final r = row as Map<String, dynamic>;
              return Card(
                child: ListTile(
                  title: Text('${r['date']}'),
                  trailing: Text('${r['orders']} ped · ${fmtMoney(r['revenue'])}'),
                ),
              );
            }),
        ],
      ),
    );
  }
}
