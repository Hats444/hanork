import 'package:flutter/foundation.dart';

import '../services/api_client.dart';

class PanelProvider extends ChangeNotifier {
  PanelProvider(this._api);

  final HanorkApiClient _api;

  bool loading = false;
  String? error;

  Map<String, dynamic>? home;
  Map<String, dynamic>? settings;
  Map<String, dynamic>? stats;
  List<dynamic> orders = [];
  int ordersTotal = 0;
  int ordersPage = 1;
  List<dynamic> users = [];
  int usersTotal = 0;
  int usersPage = 1;
  List<dynamic> salesChart = [];
  List<dynamic> logs = [];
  List<dynamic> alerts = [];

  Future<void> refreshAll() async {
    await Future.wait([
      loadHome(),
      loadSettings(),
      loadStats(),
      loadOrders(page: 1),
      loadUsers(page: 1),
      loadSalesChart(),
      loadLogs(),
    ]);
  }

  Future<void> loadHome() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      home = await _api.get('/api/v1/mobile/home');
      final events = home?['ops']?['events'] as Map<String, dynamic>?;
      alerts = (events?['alerts'] as List?) ?? [];
    } on ApiException catch (e) {
      error = e.message;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> loadSettings() async {
    try {
      settings = await _api.get('/api/v1/settings');
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  Future<void> loadStats() async {
    try {
      stats = await _api.get('/api/v1/stats');
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  Future<void> loadOrders({int page = 1, String? status}) async {
    try {
      final q = <String, String>{'page': '$page', 'limit': '25'};
      if (status != null && status.isNotEmpty) q['status'] = status;
      final data = await _api.get('/api/v1/orders', query: q);
      orders = (data['orders'] as List?) ?? [];
      ordersTotal = (data['total'] as num?)?.toInt() ?? 0;
      ordersPage = page;
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  Future<void> loadUsers({int page = 1, String q = ''}) async {
    try {
      final query = <String, String>{'page': '$page', 'limit': '25'};
      if (q.isNotEmpty) query['q'] = q;
      final data = await _api.get('/api/v1/users', query: query);
      users = (data['users'] as List?) ?? [];
      usersTotal = (data['total'] as num?)?.toInt() ?? 0;
      usersPage = page;
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  Future<void> loadSalesChart({int days = 30}) async {
    try {
      salesChart = await _api.getList('/api/v1/analytics/sales', query: {'days': '$days'});
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }

  Future<void> loadLogs() async {
    try {
      final ops = await _api.get('/api/ops/summary');
      final events = ops['events'] as Map<String, dynamic>? ?? {};
      final tg = (events['tgRecent'] as List?) ?? [];
      final wa = (events['waRecent'] as List?) ?? [];
      logs = [...tg, ...wa];
      logs.sort((a, b) {
        final ta = a is Map ? (a['ts'] ?? 0) : 0;
        final tb = b is Map ? (b['ts'] ?? 0) : 0;
        return (tb as num).compareTo(ta as num);
      });
      alerts = (events['alerts'] as List?) ?? alerts;
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
    }
  }
}
