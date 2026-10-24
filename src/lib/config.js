// Config system for clips
// Reads/writes .clips/clips.config.json

import fs from 'fs';
import path from 'path';
import { getClipsDir, getRepoRoot } from './core.js';
import { assertProjectIdAvailable, validateProjectId } from './registry.js';
import { withRecordLock } from './journal.js';
import { randomUUID } from 'node:crypto';
import { configPathIn, getUserStoreDir, projectConfigPath } from './storage-paths.js';

export const CONFIG_FILE = 'lanes.config.json';
export const LEGACY_CONFIG_FILE = 'clips.config.json';

// Default configuration values
export const DEFAULT_CONFIG = {
  default_branch: 'main',
  username: null,               // user's GitHub username
  collaboration: false,         // GitHub reads and writes require explicit opt-in
  body_max_length: null,        // max chars for imported issue descriptions (null = no limit)
  tasks_as_issues: false,       // if true, tasks are also created as separate GitHub Issues (sub-issues)
  agent_dir: null,              // agent directory name (e.g. '.agents', '.claude', '.github'); auto-detected if null
  project_id: null,             // stable project identifier; repository name when unset
  lane_max_active_agents: 5,    // per-Lane fallback when live resource management is unavailable; excludes manager
  lane_dev_max_tasks: 3,         // maximum Tasks assigned to one Lane Dev session
  lane_validation_mode: 'human',
  lane_commit_mode: 'after_validation',
  lane_pr_mode: 'none',
  view: {
    hide_goal_statuses: [],
    hide_task_statuses: [],
    hide_tasks_for_goal_statuses: ['closed', 'not_planned', 'duplicate']
  }
};

export const MODEL_PREFERENCE_DEFAULTS = {
  lane_manager_model: 'gpt-6.1-sol',
  lane_manager_reasoning_effort: 'high',
  lane_dev_model: 'gpt-6-luna',
  lane_dev_reasoning_effort: 'high',
};

export const MODEL_PREFERENCE_KEYS = Object.keys(MODEL_PREFERENCE_DEFAULTS);

export const DELIVERY_CONFIG_KEYS = [
  'lane_dev_max_tasks', 'lane_validation_mode', 'lane_commit_mode', 'lane_pr_mode',
];

function modelPreferencePath(scope, repoRoot) {
  if (scope === 'user') return configPathIn(getUserStoreDir());
  if (scope === 'project') return projectConfigPath(repoRoot);
  throw new Error(`Unknown config scope: ${scope}`);
}

function readStoredConfig(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Configuration must be a JSON object');
    }
    for (const key of MODEL_PREFERENCE_KEYS) {
      if (Object.hasOwn(config, key)) validateModelPreference(key, config[key]);
    }
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Could not read config file: ${error.message}`, { cause: error });
  }
}

function validateModelPreference(key, value) {
  if (!MODEL_PREFERENCE_KEYS.includes(key)) throw new Error(`Unknown model preference: ${key}`);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a nonempty string`);
  }
  return value.trim();
}

function writeStoredConfig(filePath, config, { createMode = 0o600 } = {}) {
  writeConfigFile(filePath, `${JSON.stringify(config, null, 2)}\n`, { createMode });
}

function writeConfigFile(filePath, content, { createMode = 0o666 } = {}) {
  let existingMode;
  try {
    existingMode = fs.statSync(filePath).mode & 0o7777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: existingMode ?? createMode });
    if (existingMode !== undefined) fs.chmodSync(temporary, existingMode);
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function getModelPreference(key, repoRoot = getRepoRoot()) {
  if (!MODEL_PREFERENCE_KEYS.includes(key)) throw new Error(`Unknown model preference: ${key}`);
  const project = readStoredConfig(modelPreferencePath('project', repoRoot));
  if (Object.hasOwn(project, key)) return validateModelPreference(key, project[key]);
  const user = readStoredConfig(modelPreferencePath('user'));
  if (Object.hasOwn(user, key)) return validateModelPreference(key, user[key]);
  return MODEL_PREFERENCE_DEFAULTS[key];
}

export function getUserModelPreference(key) {
  if (!MODEL_PREFERENCE_KEYS.includes(key)) throw new Error(`Unknown model preference: ${key}`);
  const config = readStoredConfig(modelPreferencePath('user'));
  return Object.hasOwn(config, key) ? validateModelPreference(key, config[key]) : null;
}

export function setModelPreference(key, value, { scope = 'project', repoRoot } = {}) {
  const normalized = validateModelPreference(key, value);
  const filePath = modelPreferencePath(scope, repoRoot ?? (scope === 'project' ? getRepoRoot() : undefined));
  return withRecordLock(filePath, () => {
    const config = readStoredConfig(filePath);
    config[key] = normalized;
    writeStoredConfig(filePath, config, { createMode: scope === 'user' ? 0o600 : 0o666 });
    return normalized;
  });
}

export function unsetModelPreference(key, { scope = 'project', repoRoot } = {}) {
  if (!MODEL_PREFERENCE_KEYS.includes(key)) throw new Error(`Unknown model preference: ${key}`);
  const filePath = modelPreferencePath(scope, repoRoot ?? (scope === 'project' ? getRepoRoot() : undefined));
  return withRecordLock(filePath, () => {
    const config = readStoredConfig(filePath);
    delete config[key];
    if (fs.existsSync(filePath)) {
      writeStoredConfig(filePath, config, { createMode: scope === 'user' ? 0o600 : 0o666 });
    }
  });
}

/**
 * Get the path to the config file
 */
export function getConfigPath(repoRoot = getRepoRoot()) {
  return projectConfigPath(repoRoot);
}

/**
 * Read config from file, returns merged with defaults
 */
export function readConfig(repoRoot, { strict = false } = {}) {
  const configPath = getConfigPath(repoRoot);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    if (strict && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('Configuration must be a JSON object');
    }
    if (strict) validateDeliveryConfig(parsed);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    if (strict) throw new Error(`Could not read config file: ${e.message}`, { cause: e });
    console.error(`Warning: Could not parse config file: ${e.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write config to file
 */
export function writeConfig(config, repoRoot) {
  if (Object.hasOwn(config, 'lane_max_active_agents')) {
    validateLaneLimit(config.lane_max_active_agents);
  }
  validateDeliveryConfig(config);
  const configPath = getConfigPath(repoRoot);
  if (fs.existsSync(configPath)) readConfig(repoRoot, { strict: true });
  writeConfigFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Get a single config value
 */
export function getConfigValue(key, repoRoot) {
  const config = readConfig(repoRoot, {
    strict: key === 'lane_max_active_agents' || DELIVERY_CONFIG_KEYS.includes(key),
  });
  if (key === 'lane_max_active_agents') validateLaneLimit(config[key]);
  if (DELIVERY_CONFIG_KEYS.includes(key)) validateDeliveryValue(key, config[key]);
  return config[key];
}

function validateLaneLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('lane_max_active_agents must be a positive safe integer');
  }
}

function validateDeliveryConfig(config) {
  for (const key of DELIVERY_CONFIG_KEYS) {
    if (Object.hasOwn(config, key)) validateDeliveryValue(key, config[key]);
  }
}

function validateDeliveryValue(key, value) {
  switch (key) {
    case 'lane_dev_max_tasks':
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('lane_dev_max_tasks must be a positive safe integer');
      }
      return;
    case 'lane_validation_mode':
      if (!['agent', 'human'].includes(value)) {
        throw new Error("lane_validation_mode must be 'agent' or 'human'");
      }
      return;
    case 'lane_commit_mode':
      if (!['after_validation', 'manual'].includes(value)) {
        throw new Error("lane_commit_mode must be 'after_validation' or 'manual'");
      }
      return;
    case 'lane_pr_mode':
      if (!['none', 'prepare', 'draft', 'ready'].includes(value)) {
        throw new Error("lane_pr_mode must be 'none', 'prepare', 'draft', or 'ready'");
      }
      return;
  }
}

/**
 * Set a single config value
 */
export function setConfigValue(key, value, repoRoot = getRepoRoot()) {
  return withRecordLock(getConfigPath(repoRoot), () => setConfigValueLocked(key, value, repoRoot));
}

function setConfigValueLocked(key, value, repoRoot) {
  const config = readConfig(repoRoot, { strict: true });

  // Validate key
  if (!(key in DEFAULT_CONFIG)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
  }

  // Validate value based on key
  switch (key) {
    case 'lane_max_active_agents':
      if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
      validateLaneLimit(value);
      break;
    case 'lane_dev_max_tasks':
      if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
      validateDeliveryValue(key, value);
      break;
    case 'lane_validation_mode':
    case 'lane_commit_mode':
    case 'lane_pr_mode':
      validateDeliveryValue(key, value);
      break;
    case 'project_id':
      validateProjectId(value);
      assertProjectIdAvailable(value, repoRoot);
      break;
    case 'merge_mode':
      if (!['merge', 'pr', 'wait'].includes(value)) {
        throw new Error(`Invalid merge_mode: ${value}. Must be 'merge', 'pr', or 'wait'`);
      }
      break;
    case 'auto_done_goal':
    case 'collaboration':
    case 'tasks_as_issues':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        throw new Error(`Invalid ${key}: ${value}. Must be true or false`);
      }
      // Convert string to boolean if needed
      value = value === true || value === 'true';
      break;
  }

  config[key] = value;
  writeConfig(config, repoRoot);
  return config;
}

/**
 * Initialize config file with defaults if it doesn't exist
 * @param {Object} overrides - Optional values to override defaults
 */
export function initConfig(overrides = {}, repoRoot) {
  const configPath = getConfigPath(repoRoot);

  if (fs.existsSync(configPath)) {
    return readConfig(repoRoot);
  }

  // Ensure .clips directory exists
  const clipsDir = getClipsDir(repoRoot);
  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true });
  }

  const config = { ...DEFAULT_CONFIG, ...overrides };
  writeConfig(config, repoRoot);
  return config;
}

/**
 * Check if collaboration mode is enabled
 * @returns {boolean}
 */
export function isCollaborationEnabled() {
  const config = readConfig();
  return config.collaboration === true;
}
