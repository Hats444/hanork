import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'config/theme.dart';
import 'providers/auth_provider.dart';
import 'screens/login_screen.dart';
import 'screens/shell_screen.dart';

class HanorkPanelApp extends StatelessWidget {
  const HanorkPanelApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hanork Panel',
      debugShowCheckedModeBanner: false,
      theme: hanorkTheme,
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          if (auth.loading) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return auth.isAuthenticated ? const ShellScreen() : const LoginScreen();
        },
      ),
    );
  }
}
