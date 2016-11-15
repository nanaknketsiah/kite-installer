var fs = require('fs');
var process = require('process');
var querystring = require('querystring');

var Client = require('./client.js');
var utils = require('./utils.js');

var AccountManager = {
  client: null,

  initClient: function() {
    if (this.client === null) {
      var hostname = atom.config.get('kite-installer.hostname');
      var port = atom.config.get('kite-installer.port');
      var ssl = atom.config.get('kite-installer.ssl');
      this.client = new Client(hostname, port, '', ssl);
    }
  },

  createAccount: function(data, callback) {
    this.initClient();
    if (!data.email) {
      throw new Error("No email provided");
    }
    var content = querystring.stringify(data);
    return this.client.request({
      path: '/api/account/createPasswordless',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(content),
      },
    }, callback, content);
  },

  login: function(data, callback) {
    this.initClient();
    if (!data.email) {
      throw new Error("No email provided");
    }
    if (!data.password) {
      throw new Error("No password provided");
    }
    var content = querystring.stringify(data);
    return this.client.request({
      path: '/api/account/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(content),
      },
    }, callback, content);
  },

  resetPassword: function(data, callback) {
    this.initClient();
    if (!data.email) {
      throw new Error("No email provided");
    }
    var content = querystring.stringify(data);
    return this.client.request({
      path: '/account/resetPassword/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(content),
      },
    }, callback, content);
  },

  saveSession: function(resp, callback) {
    var cookies = utils.parseSetCookies(resp.headers['set-cookie']);
    var data = JSON.stringify(cookies, null, 2);
    fs.writeFile(this.SESSION_FILE_PATH, data, {
      mode: 0o755,
    }, callback);
  }
};

module.exports = AccountManager;