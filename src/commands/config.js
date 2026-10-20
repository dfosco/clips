// Config command - view and edit clips configuration
import { readConfig, getConfigValue, setConfigValue, DEFAULT_CONFIG, getConfigPath } from '../lib/config.js';
import { getRepoRoot } from '../lib/core.js';
import { effectiveProjectId, registerProject } from '../lib/registry.js';
import fs from 'fs';

export function runConfigCommand(args) {
  const [key, value] = args;
  if (args.length === 1 && (key === '--help' || key === '-h')) return showHelp();
  if (args.length > 2) throw new Error('Usage: clips config <key> [value] or --lane-max-active-agents <N>');
  if (key === '--lane-max-active-agents') {
    if (args.length !== 2) throw new Error('--lane-max-active-agents requires a positive integer');
    return setConfig('lane_max_active_agents', value);
  }
  if (key?.startsWith('-')) throw new Error(`Unknown config option: ${key}`);
  
  // No args: show all config
  if (!key) {
    return showAllConfig();
  }
  
  // One arg: show specific key
  if (args.length === 1) {
    return showConfigKey(key);
  }
  
  // Two args: set value
  return setConfig(key, value);
}

function showAllConfig() {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  config.lane_max_active_agents = getConfigValue('lane_max_active_agents', repoRoot);
  config.project_id = effectiveProjectId(repoRoot);
  const configPath = getConfigPath(repoRoot);
  const exists = fs.existsSync(configPath);
  
  console.log('📋 clips configuration\n');
  
  if (!exists) {
    console.log('(using defaults - no .clips/clips.config.json file)\n');
  }
  
  for (const [key, value] of Object.entries(config)) {
    const isDefault = config[key] === DEFAULT_CONFIG[key];
    const marker = isDefault ? '' : ' *';
    console.log(`  ${key}: ${value}${marker}`);
  }
  
  console.log('\n* = modified from default');
  console.log('');
  showHelp();
}

function showHelp() {
  console.log(`Usage: clips config [key] [value]
  clips config                             Show configuration
  clips config <key>                        Read a value
  clips config <key> <value>                Set a value
  clips config --lane-max-active-agents <N>  Set the project default per Lane

lane_max_active_agents defaults to 5 concurrent active workers, excluding
the Lane Manager. N must be a positive safe integer (decimal digits).
Read back the numeric value: clips config lane_max_active_agents

Lane Manager applies this budget through dispatch policy, not a native
process limit. An explicit user override can apply to one Lane. Reducing
the budget does not terminate workers; defer new dispatch until capacity returns.`);
}

function showConfigKey(key) {
  const repoRoot = getRepoRoot();
  
  if (!(key in DEFAULT_CONFIG)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
    process.exit(1);
  }
  
  console.log(key === 'project_id' ? effectiveProjectId(repoRoot) : getConfigValue(key, repoRoot));
}

function setConfig(key, value) {
  try {
    const repoRoot = getRepoRoot();
    const config = setConfigValue(key, value, repoRoot);
    if (key === 'project_id') registerProject(repoRoot);
    console.log(`✅ Set ${key} = ${config[key]}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
