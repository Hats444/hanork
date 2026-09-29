import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class HanorkApiClient {
  HanorkApiClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'hanork_token';
  static const _baseUrlKey = 'hanork_base_url';

  String? _token;
  String _baseUrl = 'http://127.0.0.1:3000';

  String get baseUrl => _baseUrl.replaceAll(RegExp(r'/+$'), '');
  String? get token => _token;

  Future<void> loadPersisted() async {
    _token = await _storage.read(key: _tokenKey);
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString(_baseUrlKey) ?? _baseUrl;
  }

  Future<void> setBaseUrl(String url) async {
    _baseUrl = url.replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseUrlKey, _baseUrl);
  }

  Future<void> setToken(String? token) async {
    _token = token;
    if (token == null) {
      await _storage.delete(key: _tokenKey);
    } else {
      await _storage.write(key: _tokenKey, value: token);
    }
  }

  Map<String, String> _headers({bool json = true}) {
    final h = <String, String>{'Accept': 'application/json'};
    if (json) h['Content-Type'] = 'application/json';
    if (_token != null) h['Authorization'] = 'Bearer $_token';
    return h;
  }

  Future<Map<String, dynamic>> login(String username, String password) async {
    final res = await _client.post(
      Uri.parse('$baseUrl/api/v1/auth/login'),
      headers: _headers(),
      body: jsonEncode({'username': username, 'password': password}),
    );
    final body = _decode(res);
    if (res.statusCode >= 400) {
      throw ApiException(body['error']?.toString() ?? 'Falha no login', statusCode: res.statusCode);
    }
    final token = body['token'] as String?;
    if (token == null) throw ApiException('Token ausente na resposta');
    await setToken(token);
    return body;
  }

  Future<void> logout() async {
    try {
      await _client.post(Uri.parse('$baseUrl/api/v1/auth/logout'), headers: _headers());
    } catch (_) {}
    await setToken(null);
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final res = await _client.get(uri, headers: _headers(json: false));
    return _handle(res);
  }

  Future<Map<String, dynamic>> getJson(String path, {Map<String, String>? query}) async {
    final data = await get(path, query: query);
    return data;
  }

  Future<List<dynamic>> getList(String path, {Map<String, String>? query}) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final res = await _client.get(uri, headers: _headers(json: false));
    if (res.statusCode == 401) throw ApiException('Sessão expirada', statusCode: 401);
    if (res.statusCode >= 400) {
      final body = _tryDecode(res.body);
      throw ApiException(body?['error']?.toString() ?? 'Erro ${res.statusCode}', statusCode: res.statusCode);
    }
    final decoded = jsonDecode(res.body);
    if (decoded is List) return decoded;
    return [];
  }

  Map<String, dynamic> _handle(http.Response res) {
    if (res.statusCode == 401) throw ApiException('Sessão expirada', statusCode: 401);
    final body = _decode(res);
    if (res.statusCode >= 400) {
      throw ApiException(body['error']?.toString() ?? 'Erro ${res.statusCode}', statusCode: res.statusCode);
    }
    return body;
  }

  Map<String, dynamic> _decode(http.Response res) {
    if (res.body.isEmpty) return {};
    final decoded = jsonDecode(res.body);
    if (decoded is Map<String, dynamic>) return decoded;
    return {'data': decoded};
  }

  Map<String, dynamic>? _tryDecode(String raw) {
    try {
      final d = jsonDecode(raw);
      return d is Map<String, dynamic> ? d : null;
    } catch (_) {
      return null;
    }
  }

  void dispose() => _client.close();
}
