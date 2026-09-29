import 'package:flutter/material.dart';

final hanorkTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.dark,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF7C6AF7),
    brightness: Brightness.dark,
    surface: const Color(0xFF1A1A2E),
  ),
  scaffoldBackgroundColor: const Color(0xFF0F0F1A),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xFF1A1A2E),
    elevation: 0,
    centerTitle: false,
  ),
  cardTheme: CardThemeData(
    color: const Color(0xFF1A1A2E),
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white.withValues(alpha: 0.06),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
    ),
  ),
);
