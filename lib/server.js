var path              = require('path');
var fs                = require('fs');
var url               = require('url');

var express           = require('express');
var send              = require('send');
var chalk             = require('chalk');

var log               = require('./utils/log');
var Builder           = require('./builder');
var ExtensionRewriter = require('./utils/extensionRewriter');

var server = function(lingon, ip, port) {
  var app = express();

  lingon.server = app;

  var buildCallback = function(request, response, next) {
    return function(requestFiles) {
      if(!requestFiles || !requestFiles[0]) { return next(); }

      var file = requestFiles[0];
      response.type( send.mime.lookup(file.path) );
      response.body = file.contents;

      next();
    };
  };

  var pathCache = {};

  var testPath = function(filePath) {
    var sourcePath = path.resolve(
        lingon.rootPath,
        path.join(
          lingon.config.sourcePath,
          filePath
        )
      );

    return fs.existsSync(sourcePath);
  }

  var rewriteRequestPath = function(requestFilePath) {

    // If we don't have a cached path, or if it's no longer valid:
    // let's find it by searching all the possible filenames
    if(!pathCache[requestFilePath] || !testPath(pathCache[requestFilePath])) {

      // First, let's test of the file exists on it's own
      if(testPath(requestFilePath)) {
        // Found! Set the file to itself in the cache to speed up next request.
        pathCache[requestFilePath] = requestFilePath;
        return requestFilePath;
      }

      // Nothing found. Ok, create a list of candidate files to test:
      var candidates = ExtensionRewriter.reverseTransform({
        filename: path.basename(requestFilePath),
        extensionMap: lingon.config.extensionRewrites
      });

      // Check all candidate files
      var fileExists = false;

      for(index in candidates) {
        var candidate = path.join(path.dirname(requestFilePath), candidates[index]);

        // Does the candidate file exist?
        if (testPath(candidate)) {

          // Put the found file in the cache for faster access next time
          pathCache[requestFilePath] = path.relative(
            path.join(lingon.rootPath),
            candidate
          );

          fileExists = true;
          // We found a file! No need to keep looking.
          break;
        }
      }

      // The file does not exist, let the server handle the 404.
      if(!fileExists) {
        return requestFilePath;
      }
    }

    return pathCache[requestFilePath];
  };

  var requestHandler = function(request, response, next) {
    var requestPath = url.parse(request.url);

    // Serve directoryIndex if requestPath ends with a slash (directory)
    if(requestPath.pathname.substr(-1, 1) === '/') {
      requestPath = url.parse(requestPath.pathname + lingon.config.server.directoryIndex);
    }

    // Remove the slash
    requestPath = requestPath.pathname.substring(1);

    // Rewrite the requested path to the corresponding source file
    requestPath = rewriteRequestPath(requestPath);

    // Run lingon for the requested file
    lingon.build({
      'callback': buildCallback(request, response, next),
      'requestPath': requestPath,
      'targetPath': ip + ':' + port,
      'pipelineTerminators': []
    });
  };

  var catchAllHandler = function(request, response, next) {
    if(!response.body && lingon.config.server.catchAll) {
      lingon.build({
        'callback': buildCallback(request, response, next),
        'requestPath': lingon.config.server.catchAll,
        'pipelineTerminators': []
      });
    } else {
      next();
    }
  };

  var responseHandler = function(request, response, next) {
    if(response.body) {
      return response.send(response.body);
    }

    response.status(404).send('File not found');
  };

  app.use(lingon.config.server.namespace, requestHandler);
  lingon.trigger('serverConfigure');
  app.use(catchAllHandler);
  app.use(responseHandler);

  process.on('uncaughtException', function(error) {
    if(error.code == 'EADDRINUSE') {
      console.error('[ ' + chalk.red('Lingon') + ' ] ' + chalk.yellow('[Error] Port ' + port + ' is already in use, lingon server could not start!'));
      log('[Info] Try with a different one: ' + chalk.blue( 'lingon server -p <PORT>'));
    }
  });

  app.listen(port, ip, function() {
    log('http server listening on: http://' + ip + ':' + port);
    lingon.trigger('serverStarted');
  });

};

module.exports = server;
