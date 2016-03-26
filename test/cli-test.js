var expect       = require('chai').expect;
var RSVP         = require('rsvp');
var childProcess = require('child_process');
var path         = require('path');
var exec         = RSVP.denodeify(childProcess.exec);
var request      = require('request-promise');
var Server       = require('./helpers/cli-server');
var fixturePath  = require('./helpers/fixture-path');

var binPath = path.join(__dirname, '../bin/ember-fastboot');

describe("bin/ember-fastboot", function() {
  it("errors if there is no distPath argument provided", function() {
    return expect(exec(binPath))
      .to.eventually.be.rejectedWith(/You must call ember-fastboot with the path of a fastboot-dist directory/);
  });

  it("starts a server if distPath is provided", function() {
    this.timeout(3000);

    var server = new Server('basic-app');

    return expect(server.start()).to.be.fulfilled
      .then(function() {
        return request('http://localhost:3000');
      })
      .then(function(html) {
        expect(html).to.match(/<h2 id="title">Welcome to Ember<\/h2>/);
      })
      .finally(function() {
        server.stop();
      });
  });

  it("serves assets if the --serve-assets-from option is provided", function() {
    this.timeout(3000);

    var assetFixtures = fixturePath('browser-assets');
    var server = new Server('basic-app', {
      args: ['--serve-assets-from', assetFixtures]
    });

    return expect(server.start()).to.be.fulfilled
      .then(function() {
        return request('http://localhost:3000/assets/robots.txt');
      })
      .then(function(text) {
        expect(text).to.match(/www.robotstxt.org/);
      })
      .finally(function() {
        server.stop();
      });
  });

  it('discovers the the API responses', function() {
    this.timeout(3000);

    var api = require('express')();

    api.get('/api/posts', function(req, res) {
      res.json({data: [{
        id: 1,
        type: 'posts',
        attributes: {
          title: 'Hello World'
        }
      }]});
    });

    api.listen(1234, function() {
      console.log('Starting test API server on port 1234');
    });

    var server = new Server('data-discovery', {
      args: ['--resource-discovery']
    });

    return expect(server.start()).to.be.fulfilled
      .then(function() {
        return request('http://localhost:3000');
      })
      .then(function(html) {
        expect(html).to.match(/resource-discovery-response/);
      })
      .finally(function() {
        server.stop();
      });
  });
});
