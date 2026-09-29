import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/panel_provider.dart';
import '../utils/format.dart';
import '../widgets/stat_card.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  String? _status;

  @override
  Widget build(BuildContext context) {
    final panel = context.watch<PanelProvider>();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String?>(
                  value: _status,
                  decoration: const InputDecoration(labelText: 'Status'),
                  items: const [
                    DropdownMenuItem(value: null, child: Text('Todos')),
                    DropdownMenuItem(value: 'PAID', child: Text('Pago')),
                    DropdownMenuItem(value: 'WAITING_PAYMENT', child: Text('Aguardando')),
                    DropdownMenuItem(value: 'DELIVERED', child: Text('Entregue')),
                    DropdownMenuItem(value: 'FAILED', child: Text('Falhou')),
                  ],
                  onChanged: (v) {
                    setState(() => _status = v);
                    panel.loadOrders(page: 1, status: v);
                  },
                ),
              ),
              const SizedBox(width: 8),
              Text('${panel.ordersTotal} total', style: const TextStyle(color: Colors.white54)),
            ],
          ),
        ),
        if (panel.error != null)
          Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(message: panel.error!)),
        Expanded(
          child: panel.orders.isEmpty
              ? const EmptyState(message: 'Nenhum pedido')
              : RefreshIndicator(
                  onRefresh: () => panel.loadOrders(page: panel.ordersPage, status: _status),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: panel.orders.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final o = panel.orders[i] as Map<String, dynamic>;
                      return Card(
                        child: ListTile(
                          title: Text(fmtMoney(o['total'])),
                          subtitle: Text(
                            '${o['first_name'] ?? ''} ${o['username'] != null ? '@${o['username']}' : ''}\n${fmtDate(o['created_at'])}',
                          ),
                          isThreeLine: true,
                          trailing: Chip(
                            label: Text('${o['status']}', style: const TextStyle(fontSize: 11)),
                          ),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}
