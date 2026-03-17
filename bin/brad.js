#!/usr/bin/env node

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;

import { cli } from '../src/cli.js';

cli(process.argv);
