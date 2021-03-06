var core = require('./core');
var fs = require('fs');
var path = require('path');
var caller = require('./caller.js');
var nodeModulesPaths = require('./node-modules-paths.js');
var packagePathAndRemainder = require('./package-path-and-remainder.js');

module.exports = function resolve (x, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    if (typeof x !== 'string') {
        return process.nextTick(function () {
            cb(new Error('path must be a string'));
        });
    }
    
    var isFile = opts.isFile || function (file, cb) {
        fs.stat(file, function (err, stat) {
            if (err && err.code === 'ENOENT') cb(null, false)
            else if (err) cb(err)
            else cb(null, stat.isFile() || stat.isFIFO())
        });
    };
    var readFile = opts.readFile || fs.readFile;
    
    var extensions = opts.extensions || [ '.js' ];
    var y = opts.basedir || path.dirname(caller());
    
    opts.paths = opts.paths || [];
    
    if (/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[\\\/])/.test(x)) {
        var res = path.resolve(y, x);
        if (x === '..') res += '/';
        loadAsFile(res, function (err, m, pkg) {
            if (err) cb(err)
            else if (m) cb(null, m, pkg)
            else loadAsDirectory(path.resolve(y, x), function (err, d, pkg) {
                if (err) cb(err)
                else if (d) cb(null, d, pkg)
                else cb(new Error("Cannot find module '" + x + "' from '" + y + "'"))
            })
        });
    }
    else loadNodeModules(x, y, function (err, n, pkg) {
        if (err) cb(err)
        else if (n) cb(null, n, pkg)
        else if (core[x]) return cb(null, x);
        else cb(new Error("Cannot find module '" + x + "' from '" + y + "'"))
    });
    
    function loadAsFile (x, pkg, cb) {
        
        if (typeof pkg === 'function') {
            cb = pkg;
            pkg = opts.package;
        }
        
        var pathAndRemainder = packagePathAndRemainder(x);
        var exts = [''].concat(extensions);
        
        if (pathAndRemainder) {
            var pkgfile = path.join(pathAndRemainder.path, 'package.json');
            var remainder = pathAndRemainder.remainder;
            
            isFile(pkgfile, function (err, ex) {
                if (err) return cb(err);
                if (!ex) return load(exts, x);
                
                readFile(pkgfile, function (err, body) {
                    if (err) return cb(err);
                    try {
                        pkg = JSON.parse(body);
                    }
                    catch (err) {}
                    
                    if (opts.packageFilter) {
                        pkg = opts.packageFilter(pkg, x);
                    }
                    if (opts.pathFilter && remainder) {
                        var newRemainder = opts.pathFilter(pkg, x, remainder);
                        if (newRemainder) {
                            return load(exts, path.resolve(
                                pathAndRemainder.path, newRemainder)
                            );
                        }
                    }
                    return load(exts, x);
                });
            });
        }
        else {
            return load(exts, x);
        }
		
		function load (exts, x) {
            if (exts.length === 0) return cb(null, undefined, pkg);
            var file = x + exts[0];
            
            isFile(file, function (err, ex) {
                if (err) cb(err)
                else if (ex) cb(null, file, pkg)
                else load(exts.slice(1), x)
            });
        }
		
    }
    
    function loadAsDirectory (x, fpkg, cb) {
        if (typeof fpkg === 'function') {
            cb = fpkg;
            fpkg = opts.package;
        }
        
        var pkgfile = path.join(x, '/package.json');
        isFile(pkgfile, function (err, ex) {
            if (err) return cb(err);
            if (!ex) return loadAsFile(path.join(x, '/index'), fpkg, cb);
            
            readFile(pkgfile, function (err, body) {
                if (err) return cb(err);
                try {
                    var pkg = JSON.parse(body);
                }
                catch (err) {}
                
                if (opts.packageFilter) {
                    pkg = opts.packageFilter(pkg, x);
                }
                
                if (pkg.main) {
                    if (pkg.main === '.' || pkg.main === './'){
                        pkg.main = 'index'
                    }
                    loadAsFile(path.resolve(x, pkg.main), pkg, function (err, m, pkg) {
                        if (err) return cb(err);
                        if (m) return cb(null, m, pkg);
                        if (!pkg) return loadAsFile(path.join(x, '/index'), pkg, cb);

                        var dir = path.resolve(x, pkg.main);
                        loadAsDirectory(dir, pkg, function (err, n, pkg) {
                            if (err) return cb(err);
                            if (n) return cb(null, n, pkg);
                            loadAsFile(path.join(x, '/index'), pkg, cb);
                        });
                    });
                    return;
                }
                
                loadAsFile(path.join(x, '/index'), pkg, cb);
            });
        });
    }
    
    function loadNodeModules (x, start, cb) {
        (function process (dirs) {
            if (dirs.length === 0) return cb(null, undefined);
            var dir = dirs[0];
            
            loadAsFile(path.join(dir, '/', x), undefined, function (err, m, pkg) {
                if (err) return cb(err);
                if (m) return cb(null, m, pkg);
                loadAsDirectory(path.join(dir, '/', x), undefined, function (err, n, pkg) {
                    if (err) return cb(err);
                    if (n) return cb(null, n, pkg);
                    process(dirs.slice(1));
                });
            });
        })(nodeModulesPaths(start, opts));
    }
};
