// Anti-detection stealth script — injected via Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate
// Must remain a self-contained string (no imports, no closures)
export const STEALTH_SCRIPT = `(() => {
  if (window.__crawlioStealth) return;
  window.__crawlioStealth = true;
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true,
  });
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      ];
      plugins.length = 2;
      plugins.item = (i) => plugins[i] || null;
      plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
      plugins.refresh = () => {};
      return plugins;
    },
    configurable: true,
  });
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
  }
  var headlessVendors = /^(Google Inc\\.?|Brian Paul|Mesa|VMware|Microsoft)$/i;
  var headlessRenderers = /SwiftShader|llvmpipe|softpipe|ANGLE.*Direct3D|Mesa/i;
  var patchWebGL = function(proto) {
    var orig = proto.getParameter;
    proto.getParameter = function(parameter) {
      var val = orig.call(this, parameter);
      if (parameter === 37445 && headlessVendors.test(val)) return 'Intel Inc.';
      if (parameter === 37446 && headlessRenderers.test(val)) return 'Intel Iris OpenGL Engine';
      return val;
    };
  };
  patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchWebGL(WebGL2RenderingContext.prototype);
  }
  if (window.outerWidth === 0) {
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
  }
  if (window.outerHeight === 0) {
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85, configurable: true });
  }
})()`;
