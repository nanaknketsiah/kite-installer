const child_process = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const querystring = require('querystring');

const Client = require('./client.js');
const utils = require('./utils.js');

var StateController = {
  client: new Client('127.0.0.1', 46624, '', false),

  STATES: {
    UNSUPPORTED: 0,
    UNINSTALLED: 1,
    INSTALLED: 2,
    RUNNING: 3,
    REACHABLE: 4,
    AUTHENTICATED: 5,
    WHITELISTED: 6,
  },

  RELEASE_URLS: {
    darwin: 'https://alpha.kite.com/release/dls/mac/current',
  },
  APPS_PATH: '/Applications/',
  KITE_DMG_PATH: '/Applications/Kite.dmg',
  KITE_VOLUME_PATH: '/Volumes/Kite/',
  KITE_APP_PATH: {
    mounted: '/Volumes/Kite/Kite.app',
    installed: '/Applications/Kite.app',
  },
  KITE_SIDEBAR_PATH: '/Applications/Kite.app/Contents/MacOS/KiteSidebar.app',

  downloadedStream: null,

  isKiteSupported: function() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        os.platform() === 'darwin' ?
          resolve() :
          reject({ type: 'bad_state', data: this.STATES.UNSUPPORTED });
      }, 0);
    });
  },

  isKiteInstalled: function() {
    return new Promise((resolve, reject) => {
      this.isKiteSupported().then(() => {
        var ls = child_process.spawnSync('ls', [this.KITE_APP_PATH.installed]);
        ls.stdout.length !== 0 ?
          resolve() :
          reject({ type: 'bad_state', data: this.STATES.UNINSTALLED });
      }, (err) => {
        reject(err);
      });
    });
  },

  canInstallKite: function() {
    return new Promise((resolve, reject) => {
      this.isKiteSupported().then(() => {
        this.isKiteInstalled().then(() => {
          reject({ type: 'bad_state', data: this.STATES.INSTALLED });
        }, (err) => {
          resolve();
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  installKite: function(url, opts={}) {
    var handle = (resp, resolve, reject) => {
      if (resp.statusCode === 303) {
        this.installKite(resp.headers.location, opts).then(resolve, reject);
        return;
      }
      if (resp.statusCode !== 200) {
        reject({ type: 'bad_status', data: resp.statusCode });
        return;
      }
      typeof(opts.onDownload) === 'function' && opts.onDownload();
      if (!opts.deferWrite) {
        this.writeKite(resp, opts).then(resolve, reject);
      } else {
        this.downloadedStream = resp;
        resolve();
      }
    };

    return new Promise((resolve, reject) => {
      this.canInstallKite().then(() => {
        https.get(url, (resp) => {
          handle(resp, resolve, reject);
        }).on('error', (e) => {
          reject({ type: 'http_error', data: e });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  writeKite: function(stream, opts={}) {
    return new Promise((resolve, reject) => {
      if (!stream) {
        reject({ type: 'bad_read_stream', data: stream });
      }

      var rm = () => {
        var proc = child_process.spawn('rm', [this.KITE_DMG_PATH]);
        proc.on('close', (code) => {
          typeof(opts.onRemove) === 'function' && opts.onRemove();
          resolve();
        });
      };

      var unmount = () => {
        var proc = child_process.spawn(
          'hdiutil', ['detach', this.KITE_VOLUME_PATH]);
        proc.on('close', (code) => {
          typeof(opts.onUnmount) === 'function' && opts.onUnmount();
          rm();
        });
      };

      var cp = () => {
        var proc = child_process.spawn(
          'cp', ['-r', this.KITE_APP_PATH.mounted, this.APPS_PATH]);
        proc.on('close', (code) => {
          typeof(opts.onCopy) === 'function' && opts.onCopy();
          unmount();
        });
      };

      var mount = () => {
        var proc = child_process.spawn(
          'hdiutil', ['attach', '-nobrowse', this.KITE_DMG_PATH]);
        proc.on('close', (code) => {
          typeof(opts.onMount) === 'function' && opts.onMount();
          cp();
        });
      };

      var file = fs.createWriteStream(this.KITE_DMG_PATH);
      file.on('finish', () => {
        typeof(opts.onWrite) === 'function' && opts.onWrite();
        mount();
      });
      stream.pipe(file);
    });
  },

  writeDownloadedKite: function(opts={}) {
    return this.writeKite(this.downloadedStream, opts);
  },

  isKiteRunning: function() {
    return new Promise((resolve, reject) => {
      this.isKiteInstalled().then(() => {
        var ps = child_process.spawnSync('/bin/ps', ['-axco', 'command'], {
          encoding: 'utf8',
        });
        var procs = ps.stdout.split('\n');
        procs.indexOf('Kite') !== -1 ?
          resolve() :
          reject({ type: 'bad_state', data: this.STATES.INSTALLED });
      }, (err) => {
        reject(err);
      });
    });
  },

  canRunKite: function() {
    return new Promise((resolve, reject) => {
      this.isKiteInstalled().then(() => {
        this.isKiteRunning().then(() => {
          reject({ type: 'bad_state', data: this.STATES.RUNNING });
        }, (err) => {
          resolve();
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  runKite: function() {
    return new Promise((resolve, reject) => {
      this.canRunKite().then(() => {
        child_process.spawnSync('open', ['-a', this.KITE_APP_PATH.installed]);
        resolve();
      }, (err) => {
        reject(err);
      });
    });
  },

  isKiteReachable: function() {
    return new Promise((resolve, reject) => {
      this.isKiteRunning().then(() => {
        var req = this.client.request({
          path: '/system',
          method: 'GET',
        }, (resp) => {
          resolve();
        });
        req.on('error', (err) => {
          reject({ type: 'bad_state', data: this.STATES.RUNNING });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  waitForKite: function(attempts, interval) {
    var attemptReach = (n, resolve, reject) => {
      var wrapReject = (err) => {
        if (n + 1 >= attempts) {
          reject(err);
        } else {
          attemptReach(n + 1, resolve, reject);
        }
      };
      setTimeout(() => {
        this.isKiteReachable().then(resolve, wrapReject);
      }, n ? interval : 0);
    };
    return new Promise((resolve, reject) => {
      attemptReach(0, resolve, reject);
    });
  },

  runKiteAndWait: function(attempts, interval) {
    return new Promise((resolve, reject) => {
      this.runKite().then(() => {
        this.waitForKite(attempts, interval).then(resolve, reject);
      }, (err) => {
        reject(err);
      });
    });
  },

  isUserAuthenticated: function() {
    var handle = (resp, resolve, reject) => {
      if (resp.statusCode === 401) {
        reject({ type: 'bad_state', data: this.STATES.REACHABLE });
        return;
      } else if (resp.statusCode !== 200) {
        reject({ type: 'bad_status', data: resp.statusCode });
        return;
      }
      utils.handleResponseData(resp, (data) => {
        if (data === 'authenticated') {
          resolve();
        } else {
          reject({ type: 'bad_state', data: this.STATES.REACHABLE });
        }
      });
    };

    return new Promise((resolve, reject) => {
      this.isKiteReachable().then(() => {
        var req = this.client.request({
          path: '/api/account/authenticated',
          method: 'GET',
        }, (resp) => handle(resp, resolve, reject));
        req.on('error', (err) => {
          reject({ type: 'http_error', data: err });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  canAuthenticateUser: function() {
    return new Promise((resolve, reject) => {
      this.isKiteReachable().then(() => {
        resolve();
      }, (err) => {
        reject(err);
      });
    });
  },

  authenticateUser: function(email, password) {
    var handle = (resp, resolve, reject) => {
      switch (resp.statusCode) {
      case 200:
        resolve();
        break;
      case 401:
      case 400:
        reject({ type: 'unauthorized' });
        break;
      default:
        reject({ type: 'bad_status', data: resp.statusCode });
      }
    };

    return new Promise((resolve, reject) => {
      this.canAuthenticateUser().then(() => {
        var content = querystring.stringify({
          email: email,
          password: password,
        });
        var req = this.client.request({
          path: '/api/account/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(content),
          },
        }, (resp) => handle(resp, resolve, reject), content);
        req.on('error', (err) => {
          reject({ type: 'http_error', data: err });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  authenticateSessionID: function(key) {
    var handle = (resp, resolve, reject) => {
      switch (resp.statusCode) {
      case 200:
        resolve();
        break;
      case 401:
      case 400:
        reject({ type: 'unauthorized' });
        break;
      default:
        reject({ type: 'bad_status', data: resp.statusCode });
      }
    };

    return new Promise((resolve, reject) => {
      this.canAuthenticateUser().then(() => {
        var content = querystring.stringify({ key: key });
        var req = this.client.request({
          path: '/api/account/authenticate',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(content),
          },
        }, (resp) => handle(resp, resolve, reject), content);
        req.on('error', (err) => {
          reject({ type: 'http_error', data: err });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  isPathWhitelisted: function(path) {
    var handle = (resp, resolve, reject) => {
      if (resp.statusCode !== 200) {
        reject({ type: 'bad_status', data: resp.statusCode });
      }
      utils.handleResponseData(resp, (data) => {
        var whitelisted = false;
        try {
          var dirs = JSON.parse(data);
          for (var i = 0; i < dirs.length; i++) {
            if (path.indexOf(dirs[i]) === 0) {
              whitelisted = true;
              break;
            }
          }
        } catch (e) {
          whitelisted = false;
        }
        if (whitelisted) {
          resolve();
        } else {
          reject({ type: 'bad_state', data: this.STATES.AUTHENTICATED });
        }
      });
    };

    return new Promise((resolve, reject) => {
      this.isUserAuthenticated().then(() => {
        var req = this.client.request({
          path: '/clientapi/settings/inclusions',
          method: 'GET',
        }, (resp) => handle(resp, resolve, reject));
        req.on('error', (err) => {
          reject({ type: 'http_error', data: err });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  canWhitelistPath: function(path) {
    return new Promise((resolve, reject) => {
      this.isUserAuthenticated().then(() => {
        this.isPathWhitelisted(path).then(() => {
          reject({ type: 'bad_state', data: this.STATES.WHITELISTED });
        }, (err) => {
          resolve();
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  whitelistPath: function(path) {
    var handle = (resp, resolve, reject) => {
      if (resp.statusCode !== 200) {
        reject({ type: 'bad_status', data: resp.statusCode });
      } else {
        resolve();
      }
    };

    return new Promise((resolve, reject) => {
      this.canWhitelistPath(path).then(() => {
        var content = querystring.stringify({
          inclusions: path,
        });
        var req = this.client.request({
          path: '/clientapi/settings/inclusions',
          method: 'PUT',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(content),
          },
        }, (resp) => handle(resp, resolve, reject), content);
        req.on('error', (err) => {
          reject({ type: 'http_error', data: err });
        });
      }, (err) => {
        reject(err);
      });
    });
  },

  handleState: function(path) {
    return new Promise((resolve, reject) => {
      this.isPathWhitelisted(path).then(() => {
        resolve(this.STATES.WHITELISTED);
      }, (err) => {
        if (err.type === 'bad_state') {
          resolve(err.data);
        } else {
          reject(err);
        }
      });
    });
  },

  get releaseURL() {
    return this.RELEASE_URLS[os.platform()];
  },

  installKiteRelease: function(opts={}) {
    return this.installKite(this.releaseURL, opts);
  },
};

module.exports = StateController;