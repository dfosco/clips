// Config system for clips
// Reads/writes .clips/clips.config.json

import fs from 'fs';
import path from 'path';
import { getClipsDir, getRepoRoot } from './core.js';
import { assertProjectIdAvailable, validateProjectId } from './registry.js';

export const CONFIG_FILE = 'clips.config.json';

// Default configuration values
export const DEFAULT_CONFIG = {
  default_branch: 'main',
  username: null,               // user's GitHub username
  collaboration: false,         // GitHub reads and writes require explicit opt-in
  body_max_length: null,        // max chars for imported issue descriptions (null = no limit)
  tasks_as_issues: false,       // if true, tasks are also created as separate GitHub Issues (sub-issues)
  agent_dir: null,              // agent directory name (e.g. '.agents', '.claude', '.github'); auto-detected if null
  project_id: null,             // stable board identifier; repository name when unset
  view: {
    hide_goal_statuses: [],
    hide_task_statuses: [],
    hide_tasks_for_goal_statuses: ['closed', 'not_planned', 'duplicate']
  }
};

/**
 * Get the path to the config file
 */
export function getConfigPath(repoRoot) {
  return path.join(getClipsDir(repoRoot), CONFIG_FILE);
}

/**
 * Read config from file, returns merged with defaults
 */
export function readConfig(repoRoot) {
  const configPath = getConfigPath(repoRoot);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    console.error(`Warning: Could not parse config file: ${e.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write config to file
 */
export function writeConfig(config, repoRoot) {
  const configPath = getConfigPath(repoRoot);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get a single config value
 */
export function getConfigValue(key, repoRoot) {
  const config = readConfig(repoRoot);
  return config[key];
}

/**
 * Set a single config value
 */
export function setConfigValue(key, value, repoRoot = getRepoRoot()) {
  const config = readConfig(repoRoot);

  // Validate key
  if (!(key in DEFAULT_CONFIG)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
  }

  // Validate value based on key
  switch (key) {
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
