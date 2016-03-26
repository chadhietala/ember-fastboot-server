var chalk    = require('chalk');
var fs       = require('fs');
var path     = require('path');
var util     = require('util');
var EmberApp = require('./ember-app');
var debug    = require('debug')('ember-cli-fastboot:server');

function FastBootServer(options) {
  options = options || {};

  var distPath = options.distPath;

  if (!distPath) {
    throw new Error('You must instantiate FastBootServer with a distPath ' +
                    'option that contains a path to a fastboot-dist directory ' +
                    'produced by running ember fastboot:build in your Ember app:' +
                    '\n\n' +
                    'new FastBootServer({\n' +
                    '  distPath: \'path/to/fastboot-dist\'\n' +
                    '});');
  }

  var config = readPackageJSON(distPath);

  // Stubs out the `ui` object for printing to the terminal used
  // by Ember CLI addons.
  var defaultUI = {
    writeLine: function() {
      console.log.apply(console, arguments);
    }
  };

  this.app = new EmberApp({
    distPath: path.resolve(distPath),
    appFile: config.appFile,
    vendorFile: config.vendorFile,
    moduleWhitelist: config.moduleWhitelist,
    hostWhitelist: config.hostWhitelist,
    resourceDiscovery: options.resourceDiscovery
  });

  this.html = fs.readFileSync(config.htmlFile, 'utf8');

  this.ui = options.ui || defaultUI;
}

FastBootServer.prototype.log = function(statusCode, message, startTime) {
  var color = statusCode === 200 ? 'green' : 'red';
  var now = new Date();

  if (startTime) {
    var diff = Date.now() - startTime;
    message = message + chalk.blue(" " + diff + "ms");
  }

  this.ui.writeLine(chalk.blue(now.toISOString()) + " " + chalk[color](statusCode) + " " + message);
};

FastBootServer.prototype.insertIntoIndexHTML = function(title, body, head) {
  var html = this.html.replace("<!-- EMBER_CLI_FASTBOOT_BODY -->", body);

  if (title) {
    html = html.replace("<!-- EMBER_CLI_FASTBOOT_TITLE -->", "<title>" + title + "</title>");
  }
  if (head) {
    html = html.replace("<!-- EMBER_CLI_FASTBOOT_HEAD -->", head);
  }

  return html;
};

FastBootServer.prototype.handleSuccess = function(res, path, result, startTime) {
  this.log(200, 'OK ' + path, startTime);
  res.send(this.insertIntoIndexHTML(result.title, result.body, result.head));
};

FastBootServer.prototype.handleFailure = function(res, path, error, startTime) {
  if (error.name === "UnrecognizedURLError") {
    this.log(404, "Not Found " + path, startTime);
    res.sendStatus(404);
  } else {
    console.log(error.stack);
    this.log(500, "Unknown Error: " + error, startTime);
    res.sendStatus(500);
  }
};

FastBootServer.prototype.handleAppBootFailure = function(error) {
  debug("app boot failed");
  self.ui.writeLine(chalk.red("Error loading the application."));
  self.ui.writeLine(error);
};

FastBootServer.prototype.middleware = function() {
  return function(req, res, next) {
    var path = req.url;
    debug("middleware request; path=%s", path);

    var server = this;

    debug("handling url; url=%s", path);

    var startTime = Date.now();

    this.app.visit(path, { request: req, response: res })
      .then(success, failure)
      .finally(function() {
        debug("finished handling; url=%s", path);
      });

    function success(result) {
      server.handleSuccess(res, path, result, startTime);
    }

    function failure(error) {
      server.handleFailure(res, path, error, startTime);
    }
  }.bind(this);
};

function readPackageJSON(distPath) {
  var pkgPath = path.join(distPath, 'package.json');
  var file;

  try {
    file = fs.readFileSync(pkgPath);
  } catch (e) {
    throw new Error(util.format("Couldn't find %s. You may need to update your version of ember-cli-fastboot.", pkgPath));
  }

  var manifest;
  var pkg;

  try {
    pkg = JSON.parse(file);
    manifest = pkg.fastboot.manifest;
  } catch (e) {
    throw new Error(util.format("%s was malformed or did not contain a manifest. Ensure that you have a compatible version of ember-cli-fastboot.", pkgPath));
  }

  return {
    appFile:  path.join(distPath, manifest.appFile),
    vendorFile: path.join(distPath, manifest.vendorFile),
    htmlFile: path.join(distPath, manifest.htmlFile),
    moduleWhitelist: pkg.fastboot.moduleWhitelist,
    hostWhitelist: pkg.fastboot.hostWhitelist
  };
}

module.exports = FastBootServer;
