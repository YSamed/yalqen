// Native full screen slides an empty title strip (NSToolbarFullScreenWindow) down with the menu bar.
// Electron has no option for it, so the strip window stays transparent and click-through, and its
// position tells how far the menu bar covers the window.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <objc/runtime.h>

static IMP originalSetAlphaValue = nullptr;

static Class StripClass() {
  return NSClassFromString(@"NSToolbarFullScreenWindow");
}

// AppKit sets the strip opaque right before sliding it in, so clamp every alpha change.
static void SetStripAlphaValue(id self, SEL selector, CGFloat) {
  ((void (*)(id, SEL, CGFloat))originalSetAlphaValue)(self, selector, 0);
}

static void MakeStripClickThrough(NSNotification* note) {
  NSWindow* window = note.object;
  if ([window isKindOfClass:StripClass()] && !window.ignoresMouseEvents) window.ignoresMouseEvents = YES;
}

static napi_value HideFullScreenTitlebar(napi_env env, napi_callback_info info) {
  static bool installed = false;
  Class strip = StripClass();
  if (installed || !strip) return nullptr;
  installed = true;
  Method method = class_getInstanceMethod(strip, @selector(setAlphaValue:));
  originalSetAlphaValue = method_getImplementation(method);
  if (!class_addMethod(strip, @selector(setAlphaValue:), (IMP)SetStripAlphaValue, method_getTypeEncoding(method))) {
    method_setImplementation(method, (IMP)SetStripAlphaValue);
  }
  for (NSNotificationName name in @[ NSWindowDidUpdateNotification, NSWindowDidMoveNotification ]) {
    [[NSNotificationCenter defaultCenter] addObserverForName:name
                                                      object:nil
                                                       queue:nil
                                                  usingBlock:^(NSNotification* note) {
                                                    MakeStripClickThrough(note);
                                                  }];
  }
  return nullptr;
}

// Top of the strip (the menu bar's lower edge) in points below the window's top edge; null outside full screen.
// It is negative while the strip is parked above the screen, and equals the covered height once the menu bar is down.
static napi_value MenuBarEdge(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_value result;
  napi_get_null(env, &result);
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void* data = nullptr;
  size_t length = 0;
  if (argc < 1 || napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || length < sizeof(void*)) return result;
  NSWindow* window = ((__bridge NSView*)(*(void**)data)).window;
  NSWindow* strip = [window standardWindowButton:NSWindowCloseButton].window;
  if (!window || !strip || strip == window || !(window.styleMask & NSWindowStyleMaskFullScreen)) return result;
  napi_create_double(env, NSMaxY(window.frame) - NSMaxY(strip.frame), &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value hide, edge;
  napi_create_function(env, "hideFullScreenTitlebar", NAPI_AUTO_LENGTH, HideFullScreenTitlebar, nullptr, &hide);
  napi_create_function(env, "menuBarEdge", NAPI_AUTO_LENGTH, MenuBarEdge, nullptr, &edge);
  napi_set_named_property(env, exports, "hideFullScreenTitlebar", hide);
  napi_set_named_property(env, exports, "menuBarEdge", edge);
  return exports;
}
