// Config command - view and edit lanes configuration
import {
  readConfig, getConfigValue, setConfigValue, DEFAULT_CONFIG, getConfigPath,
  getModelPreference, getUserModelPreference, MODEL_PREFERENCE_KEYS,
  setModelPreference, unsetModelPreference,
} from '../lib/config.js';
import { getRepoRoot } from '../lib/core.js';
import { effectiveProjectId, registerProject } from '../lib/registry.js';
import fs from 'fs';

export function runConfigCommand(args) {
  const [key, value] = args;
  if (args.length === 1 && (key === '--help' || key === '-h')) return showHelp();
  if (key === '--user') return runUserConfigCommand(args.slice(1));
  if (args.length > 2) throw new Error('Usage: lanes config <key> [value] or --lane-max-active-agents <N>');
  if (key === '--lane-max-active-agents') {
    if (args.length !== 2) throw new Error('--lane-max-active-agents requires a positive integer');
    return setConfig('lane_max_active_agents', value);
  }
  if (key?.startsWith('-')) throw new Error(`Unknown config option: ${key}`);
  
  // No args: show all config
  if (!key) {
    return showAllConfig();
  }

  if (MODEL_PREFERENCE_KEYS.includes(key)) {
    if (value === '--unset') return unsetPreference(key, 'project');
    if (args.length === 1) return showConfigKey(key);
    return setPreference(key, value, 'project');
  }
  
  // One arg: show specific key
  if (args.length === 1) {
    return showConfigKey(key);
  }
  
  // Two args: set value
  return setConfig(key, value);
}

function runUserConfigCommand(args) {
  if (args.length < 1 || args.length > 2) {
    throw new Error('Usage: lanes config --user <model-key> [value|--unset]');
  }
  const [key, value] = args;
  if (!MODEL_PREFERENCE_KEYS.includes(key)) {
    throw new Error(`User scope supports only model preferences: ${MODEL_PREFERENCE_KEYS.join(', ')}`);
  }
  if (args.length === 1) {
    const preference = getUserModelPreference(key);
    console.log(preference ?? '(not set)');
    return;
  }
  if (value === '--unset') return unsetPreference(key, 'user');
  return setPreference(key, value, 'user');
}

function showAllConfig() {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot, { strict: true });
  config.lane_max_active_agents = getConfigValue('lane_max_active_agents', repoRoot);
  config.project_id = effectiveProjectId(repoRoot);
  const configPath = getConfigPath(repoRoot);
  const exists = fs.existsSync(configPath);
  
  console.log('📋 lanes configuration\n');
  
  if (!exists) {
    console.log(`(using defaults - no ${configPath} file)\n`);
  }
  
  for (const [key, value] of Object.entries(config)) {
    if (MODEL_PREFERENCE_KEYS.includes(key)) continue;
    const isDefault = config[key] === DEFAULT_CONFIG[key];
    const marker = isDefault ? '' : ' *';
    console.log(`  ${key}: ${value}${marker}`);
  }

  for (const key of MODEL_PREFERENCE_KEYS) {
    console.log(`  ${key}: ${getModelPreference(key, repoRoot)} (resolved)`);
  }
  
  console.log('\n* = modified from default');
  console.log('');
  showHelp();
}

function showHelp() {
  console.log(`Usage: lanes config [key] [value]
  lanes config                             Show configuration
  lanes config <key>                        Read a value
  lanes config <key> <value>                Set a value
  lanes config <model-key> --unset         Remove a project model override
  lanes config --user <model-key> [value]  Read or set a user model preference
  lanes config --user <model-key> --unset  Remove a user model override
  lanes config --lane-max-active-agents <N>  Set the project default per Lane

Model preferences resolve project > user > built-in. Built-in values are
gpt-6.1-sol/high for Lane Managers and gpt-6-luna/high for Lane Devs.
The --user forms work outside a Git repository. Reading a model key without
--user returns its effective value; a user-scoped read shows only that override.
Model identifiers are stored as provided; availability is determined at dispatch.
Keys: lane_manager_model, lane_manager_reasoning_effort, lane_dev_model,
lane_dev_reasoning_effort.

Delivery preferences:
lane_dev_max_tasks defaults to 3 Tasks per Lane Dev assignment. A worker's
assignment ends and it retires when its assigned Tasks are complete, even when
the cap has not been reached. lane_validation_mode defaults to human and may be
agent. Human validation is the default for Goal review; agent mode is an explicit
opt-out only where no named human gate applies. lane_commit_mode defaults to
after_validation and may be manual.
lane_pr_mode defaults to none and may be prepare, draft, or ready. These settings
guide workflow; they do not enforce scheduling, approve commits, or authorize
external actions. PR modes describe desired output only. Manual commit mode
leaves an explicit commit handoff for the designated coordinator.

Read and set delivery preferences with lanes config <key> [value]. Invalid
values and malformed stored delivery settings fail visibly and remain on disk.

lane_max_active_agents defaults to 5 concurrent active workers, excluding
the Lane Manager. N must be a positive safe integer (decimal digits).
Read back the numeric value: lanes config lane_max_active_agents

Lane Manager applies this budget through dispatch policy, not a native
process limit. An explicit user override can apply to one Lane. Reducing
the budget does not terminate workers; defer new dispatch until capacity returns.`);
}

function showConfigKey(key) {
  const repoRoot = getRepoRoot();
  
  if (MODEL_PREFERENCE_KEYS.includes(key)) {
    console.log(getModelPreference(key, repoRoot));
    return;
  }

  if (!(key in DEFAULT_CONFIG)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
    process.exit(1);
  }
  
  console.log(key === 'project_id' ? effectiveProjectId(repoRoot) : getConfigValue(key, repoRoot));
}

function setPreference(key, value, scope) {
  try {
    const options = scope === 'user' ? { scope } : { scope, repoRoot: getRepoRoot() };
    const preference = setModelPreference(key, value, options);
    console.log(`✅ Set ${scope} ${key} = ${preference}`);
  } catch (error) {
    throw new Error(error.message, { cause: error });
  }
}

function unsetPreference(key, scope) {
  try {
    const options = scope === 'user' ? { scope } : { scope, repoRoot: getRepoRoot() };
    unsetModelPreference(key, options);
    console.log(`✅ Removed ${scope} override for ${key}`);
  } catch (error) {
    throw new Error(error.message, { cause: error });
  }
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
