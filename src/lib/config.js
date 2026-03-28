// Config system for clips
// Reads/writes .clips/clips.config.json

import fs from 'fs';
import path from 'path';
import { getClipsDir, getRepoRoot } from './core.js';

export const CONFIG_FILE = 'clips.config.json';

// Default configuration values
export const DEFAULT_CONFIG = {
  default_branch: 'main',
  username: null,               // user's GitHub username
  collaboration: true,          // if false, .clips is gitignored and sync/commit operations are disabled
  auto_commit: true,            // if false, skip git commit/push after mutations
  body_max_length: null,        // max chars for imported issue descriptions (null = no limit)
  tasks_as_issues: false,       // if true, tasks are also created as separate GitHub Issues (sub-issues)
  view: {
    hide_goal_statuses: [],
    hide_task_statuses: [],
    hide_tasks_for_goal_statuses: ['closed', 'not_planned', 'duplicate']
  }
};

/**
 * Get the path to the config file
 */
export function getConfigPath() {
  return path.join(getClipsDir(), CONFIG_FILE);
}

/**
 * Read config from file, returns merged with defaults
 */
export function readConfig() {
  const configPath = getConfigPath();

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
export function writeConfig(config) {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get a single config value
 */
export function getConfigValue(key) {
  const config = readConfig();
  return config[key];
}

/**
 * Set a single config value
 */
export function setConfigValue(key, value) {
  const config = readConfig();

  // Validate key
  if (!(key in DEFAULT_CONFIG)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`);
  }

  // Validate value based on key
  switch (key) {
    case 'merge_mode':
      if (!['merge', 'pr', 'wait'].includes(value)) {
        throw new Error(`Invalid merge_mode: ${value}. Must be 'merge', 'pr', or 'wait'`);
      }
      break;
    case 'auto_done_goal':
    case 'collaboration':
    case 'auto_commit':
    case 'tasks_as_issues':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        throw new Error(`Invalid ${key}: ${value}. Must be true or false`);
      }
      // Convert string to boolean if needed
      value = value === true || value === 'true';
      break;
  }

  config[key] = value;
  writeConfig(config);
  return config;
}

/**
 * Initialize config file with defaults if it doesn't exist
 * @param {Object} overrides - Optional values to override defaults
 */
export function initConfig(overrides = {}) {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    return readConfig();
  }

  // Ensure .clips directory exists
  const clipsDir = getClipsDir();
  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true });
  }

  const config = { ...DEFAULT_CONFIG, ...overrides };
  writeConfig(config);
  return config;
}

/**
 * Ensure solo mode is properly configured
 * If collaboration is false and .clips is not in .gitignore, add it
 */
export function ensureSoloMode() {
  const config = readConfig();
  if (config.collaboration !== false) return;

  const repoRoot = getRepoRoot();
  const gitignorePath = path.join(repoRoot, '.gitignore');

  // Check if .clips is already in .gitignore
  let gitignoreContent = '';
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const lines = gitignoreContent.split('\n');
    if (lines.some(line => line.trim() === '.clips' || line.trim() === '.clips/')) {
      return; // Already ignored
    }
  }

  // Add .clips to .gitignore
  const newEntry = gitignoreContent.endsWith('\n') || gitignoreContent === ''
    ? '.clips/\n'
    : '\n.clips/\n';
  fs.appendFileSync(gitignorePath, newEntry);
}

/**
 * Check if collaboration mode is enabled
 * @returns {boolean}
 */
export function isCollaborationEnabled() {
  const config = readConfig();
  return config.collaboration !== false;
}
