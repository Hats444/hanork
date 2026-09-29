import 'package:intl/intl.dart';

final brl = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

String fmtMoney(dynamic v) {
  final n = v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
  return brl.format(n);
}

String fmtDate(dynamic v) {
  if (v == null) return '—';
  final d = DateTime.tryParse(v.toString());
  if (d == null) return v.toString();
  return DateFormat('dd/MM/yyyy HH:mm').format(d.toLocal());
}

String fmtTs(dynamic v) {
  if (v == null) return '—';
  if (v is num) {
    final ms = v > 1e12 ? v.toInt() : (v * 1000).toInt();
    return fmtDate(DateTime.fromMillisecondsSinceEpoch(ms));
  }
  return fmtDate(v);
}
