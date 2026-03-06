#!/usr/bin/env node
import { main } from '../src/codeclaw.js';
main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
