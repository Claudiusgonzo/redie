#!/usr/bin/env node

/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
var process = require('process');
var fs = require('fs');
var commandLineArgs = require('command-line-args');
var readline = require('readline');
var split = require('argv-split');
var redis = require('redis');
var redisCommands = require('redis-commands');
var isJSON = require('is-json');
var colorJSON = require('json-colorz');
var package = require('./package.json');
var painlessConfig = require('painless-config');

var args = getArgs();
var options = getOptions(args);
if (options.help) {
  console.log(getUsage(args));
  return;
}
if (options.version) {
  console.log(getVersion());
  return;
}

var firstConnect = true;
var client = createRedisClient(options);
client.on('error', (err) => {
  console.error(err.message);
  quitCommand();
});
client.on('ready', () => {
  if (firstConnect) {
    firstConnect = false;
    startReplLoop();
  }
});

var lastReply;
function startReplLoop() {
  var commands = getCommands();

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.setPrompt(options.hostname + '> ');
  rl.prompt();

  rl.on('line', (line) => {
    var command = split(line);

    var commandName = command.length === 0 ? 'NOOP' : command[0].toUpperCase();
    var commandArgs = command.splice(1);
    var commandFunc = commands[commandName];
    if (!commandFunc) {
      commandFunc = commands.HELP;
      commandArgs = [];
      console.error('Unknown command \'' + commandName + '\', valid commands are:');
    }

    commandFunc(commandName, commandArgs, (err, reply) => {
      if (err) console.error(err);
      if (reply) displayReply(reply);
      lastReply = reply;
      rl.prompt();
    });
  }).on('close', () => {
    process.exit(0);
  });
}

function getVersion() {
  return package.name + ' ' + package.version;
}

function getArgs() {
  var cli = commandLineArgs([
    { name: 'hostname', alias: 'h', type: String, defaultValue: painlessConfig.get('REDIS_HOSTNAME') || '127.0.0.1' },
    { name: 'port', alias: 'p', type: Number, defaultValue: painlessConfig.get('REDIS_PORT') },
    { name: 'password', alias: 'a', type: String, defaultValue: painlessConfig.get('REDIS_PASSWORD') },
    { name: 'tls', type: Boolean, defaultValue: !!painlessConfig.get('REDIS_TLS') },
    { name: 'version', alias: 'v', type: Boolean },
    { name: 'help', alias: '?', type: Boolean }
  ]);

  return cli;
}

function getOptions(args) {
  var options = args.parse();
  if (!options.port) {
    options.port = options.tls ? 6380 : 6379;
  }
  return options;
}

function getUsage(args) {
  return args.getUsage({ title: getVersion(), description: package.description });
}

function createRedisClient(options) {
  var redisOptions = {};
  if (options.password) redisOptions.auth_pass = options.password;
  if (options.tls) redisOptions.tls = { servername: options.hostname };

  var client = redis.createClient(options.port, options.hostname, redisOptions);
  return client;
}

function getCommands() {
  var commands = {};
  for (var i = 0; i < redisCommands.list.length; i++) {
    commands[redisCommands.list[i].toUpperCase()] = client.send_command.bind(client);
  }
  commands[''] = noopCommand;
  commands.HELP = helpCommand;
  commands.NOOP = noopCommand;
  commands.EXIT = quitCommand;
  commands.QUIT = quitCommand;
  commands.SAVE = saveCommand;
  return commands;
}

function helpCommand(name, args, callback) {
  var matchingCommands = [];
  for (var i = 0; i < redisCommands.list.length; i++) {
    if (args.length === 0 || redisCommands.list[i].toUpperCase().indexOf(args[0].toUpperCase()) > -1) {
      matchingCommands.push(redisCommands.list[i].toUpperCase());
    }
  }
  callback(null, matchingCommands);
}

function noopCommand(name, args, callback) {
  callback(null, null);
}

function quitCommand(name, args, callback) {
  if (client) client.unref();
  process.exit(0);
}

function saveCommand(name, args, callback) {
  if (args.length !== 1) return callback('SAVE filename', null);
  if (!lastReply) return callback('No reply to save', null);

  var fileContent;
  if (typeof lastReply === 'string') {
    fileContent = lastReply;
  } else {
    fileContent = JSON.stringify(lastReply);
  }

  var filename = args[0];
  fs.writeFileSync(filename, fileContent);
  callback(null, 'Saved last reply to ' + filename);
}

function displayReply(reply) {
  // Formatters
  if (typeof reply === 'string') {
    if (isJSON(reply)) {
      reply = JSON.parse(reply);
    }
  }

  // Renderers
  if (typeof reply === 'string') {
    console.log(reply);
  } else {
    colorJSON(reply);
  }
}