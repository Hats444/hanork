import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'providers/auth_provider.dart';
import 'providers/panel_provider.dart';
import 'services/api_client.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = HanorkApiClient();
  final auth = AuthProvider(api);
  await auth.init();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: auth),
        ChangeNotifierProvider(create: (_) => PanelProvider(api)),
      ],
      child: const HanorkPanelApp(),
    ),
  );
}
