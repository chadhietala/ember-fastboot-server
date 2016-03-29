var fs = require('fs');
var path = require('path');

var Contextify = require('contextify');
var SimpleDOM = require('simple-dom');
var chalk = require('chalk');
var najax = require('najax');
var debug   = require('debug')('ember-cli-fastboot:ember-app');
var sourceMapSupport = require('./install-source-map-support');
var FastBootInfo = require('./fastboot-info');
var EventEmitter = require('events');

var HTMLSerializer = new SimpleDOM.HTMLSerializer(SimpleDOM.voidMap);

function EmberApp(options) {
  var distPath = options.distPath;
  this.resourceDiscoveryMode = options.resourceDiscovery;
  this.emitter = new EventEmitter();

  var appFilePath = options.appFile;
  var vendorFilePath = options.vendorFile;
  var moduleWhitelist = options.moduleWhitelist;

  debug("app created; app=%s; vendor=%s", appFilePath, vendorFilePath);

  moduleWhitelist.forEach(function(whitelistedModule) {
    debug("module whitelisted; module=%s", whitelistedModule);
  });

  var self = this;
  function streamResponse(data, status) {
    self.emitter.emit('data', data, status);
  }

  function streamError(xhr, options, thrownError) {
    self.emitter.emit('error', thrownError, xhr.status);
  }

  // Create the sandbox, giving it the resolver to resolve once the app
  // has booted.
  var sandboxRequire = buildWhitelistedRequire(moduleWhitelist, distPath);
  var sandbox;
  if (this.resourceDiscoveryMode) {
    sandbox = createSandbox({
      najax: najax,
      streamResponse: streamResponse,
      streamError: streamError,
      FastBoot: { require: sandboxRequire }
    });
  } else {
    sandbox = createSandbox({
      najax: najax,
      FastBoot: { require: sandboxRequire }
    });
  }

  sourceMapSupport.install(Error);
  sandbox.run('sourceMapSupport.install(Error);');

  var appFile = fs.readFileSync(appFilePath, 'utf8');
  var vendorFile = fs.readFileSync(vendorFilePath, 'utf8');

  sandbox.run(vendorFile, vendorFilePath);
  debug("vendor file evaluated");

  sandbox.run(appFile, appFilePath);
  debug("app file evaluated");

  var AppFactory = sandbox.require('~fastboot/app-factory');

  if (!AppFactory || typeof AppFactory['default'] !== 'function') {
    throw new Error('Failed to load Ember app from ' + appFilePath + ', make sure it was built for FastBoot with the `ember fastboot:build` command.');
  }

  this._app = AppFactory['default']();
}

EmberApp.prototype.buildApp = function() {
  return this._app.boot().then(function(app) {
    return app.buildInstance();
  });
};

/*
 * Called by an HTTP server to render the app at a specific URL.
 */
EmberApp.prototype.visit = function(path, options) {
  var req = options.request;
  var res = options.response;
  var datalets = [];

  var datalet = function(data){
    return '<script class="resource-discovery-response">' +
           JSON.stringify(data) +
           '</script>';
  }
                ''
  this.emitter.on('data', function(data) {
    datalets.push(datalet(data));
  });

  this.emitter.on('error', function(err) {
    throw err;
  });

  var bootOptions = buildBootOptions();
  var doc = bootOptions.document;
  var rootElement = bootOptions.rootElement;

  if (this.resourceDiscoveryMode) {
    return this.buildApp().then(registerFastBootInfo(req, res))
    .then(function(instance) {
      return instance.boot(bootOptions);
    })
    .then(function(instance) {
      return instance.visit(path, bootOptions);
    }).then(serializeHTML(doc, rootElement, datalets));
  }

  return this.buildApp()
    .then(registerFastBootInfo(req, res))
    .then(function(instance) {
      return instance.boot(bootOptions);
    })
    .then(function(instance) {
      return instance.visit(path, bootOptions);
    })
    .then(serializeHTML(doc, rootElement));
};

/*
 * Builds an object with the options required to boot an ApplicationInstance in
 * FastBoot mode.
 */
function buildBootOptions() {
  var doc = new SimpleDOM.Document();
  var rootElement = doc.body;

  return {
    isBrowser: false,
    document: doc,
    rootElement: rootElement
  };
}

/*
 * Builds a new FastBootInfo instance with the request and response and injects
 * it into the application instance.
 */
function registerFastBootInfo(req, res) {
  return function(instance) {
    var info = new FastBootInfo(req, res);
    info.register(instance);

    return instance;
  };
}

/*
 * After the ApplicationInstance has finished rendering, serializes the
 * resulting DOM element into HTML to be transmitted back to the user agent.
 */
function serializeHTML(doc, rootElement, datalets) {
  return function(instance) {
    var head;

    if (doc.head) {
      head = HTMLSerializer.serialize(doc.head);
    }

    try {
      return {
        url: instance.getURL(), // TODO: use this to determine whether to 200 or redirect
        title: doc.title,
        head: head,
        body: datalets.join('\n') + HTMLSerializer.serialize(rootElement) // This matches the current code; but we probably want `serializeChildren` here
      };
    } finally {
      instance.destroy();
    }
  };
}

function createSandbox(dependencies) {
  var wrappedConsole =  Object.create(console);
  wrappedConsole.error = function() {
    console.error.apply(console, Array.prototype.map.call(arguments, function(a) {
      return typeof a === 'string' ? chalk.red(a) : a;
    }));
  };

  var sandbox = {
    sourceMapSupport: sourceMapSupport,
    // Expose the console to the FastBoot environment so we can debug
    console: wrappedConsole,

    // setTimeout and clearTimeout are an assumed part of JavaScript environments. Expose it.
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,

    // Convince jQuery not to assume it's in a browser
    module: { exports: {} },

    URL: require("url")
  };

  for (var dep in dependencies) {
    sandbox[dep] = dependencies[dep];
  }

  // Set the global as `window`.
  sandbox.window = sandbox;
  sandbox.window.self = sandbox;

  // The sandbox is now a JavaScript context O_o
  Contextify(sandbox);

  return sandbox;
}

function buildWhitelistedRequire(whitelist, distPath) {
  return function(moduleName) {
    if (whitelist.indexOf(moduleName) > -1) {
      return require(path.join(distPath, 'node_modules', moduleName));
    } else {
      throw new Error("Unable to require module '" + moduleName + "' because it was not in the whitelist.");
    }
  };
}

module.exports = EmberApp;
