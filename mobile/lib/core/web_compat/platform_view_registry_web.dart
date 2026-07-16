import 'dart:ui_web' as ui_web;

import 'platform_view_registry_stub.dart';

bool registerViewFactory(String viewType, ViewFactory factory) {
  ui_web.platformViewRegistry.registerViewFactory(viewType, factory);
  return true;
}
