// Config command - view and edit clips configuration
import { readConfig, setConfigValue, DEFAULT_CONFIG, getConfigPath } from '../lib/config.js';
import fs from 'fs';

export function runConfigCommand(args) {
  const [key, value] = args;
  
  // No args: show all config
  if (!key) {
    return showAllConfig();
  }
  
  // One arg: show specific key
  if (!value) {
    return showConfigKey(key);
  }
  
  // Two args: set value
  return setConfig(key, value);
}

function showAllConfig() {
  const config = readConfig();
  const configPath = getConfigPath();
  const exists = fs.existsSync(configPath);
  
  console.log('📋 clips configuration\n');
  
  if (!exists) {
    console.log('(using defaults - no .clips/clips.config file)\n');
  }
  
  for (const [key, value] of Object.entries(config)) {
    const isDefault = config[key] === DEFAULT_CONFIG[key];
    const marker = isDefault ? '' : ' *';
    console.log(`  ${key}: ${value}${marker}`);
  }
  
  console.log('\n* = modified from default');
  console.log('\nUsage:');
  console.log('  clips config <key>          # Show value');
  console.log('  clips config <key> <value>  # Set value');
}

function showConfigKey(key) {
  const config = readConfig();
  
  if (!(key in DEFAULT_CONFIG)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
    process.exit(1);
  }
  
  console.log(config[key]);
}

function setConfig(key, value) {
  try {
    const config = setConfigValue(key, value);
    console.log(`✅ Set ${key} = ${config[key]}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
