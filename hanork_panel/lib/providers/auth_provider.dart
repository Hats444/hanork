import 'package:flutter/foundation.dart';

import '../services/api_client.dart';

class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api);

  final HanorkApiClient _api;
  bool loading = true;
  String? error;
  String? username;
  String baseUrl = 'http://127.0.0.1:3000';

  HanorkApiClient get api => _api;
  bool get isAuthenticated => _api.token != null;

  Future<void> init() async {
    loading = true;
    notifyListeners();
    await _api.loadPersisted();
    baseUrl = _api.baseUrl;
    if (_api.token != null) {
      try {
        final me = await _api.get('/api/v1/auth/me');
        username = me['user']?['id']?.toString();
      } catch (_) {
        await _api.setToken(null);
      }
    }
    loading = false;
    notifyListeners();
  }

  Future<bool> login(String user, String pass, {String? serverUrl}) async {
    error = null;
    if (serverUrl != null && serverUrl.trim().isNotEmpty) {
      await _api.setBaseUrl(serverUrl.trim());
      baseUrl = _api.baseUrl;
    }
    try {
      final res = await _api.login(user, pass);
      username = res['user']?['id']?.toString() ?? user;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    await _api.logout();
    username = null;
    notifyListeners();
  }
}
