import { readConfig } from './config.js';

const COMMANDS = Object.freeze({
  control: 'lanes config collaboration true|false',
  status: 'lanes sync status --json',
  preview: 'lanes sync preview [record-ref] --json',
  sync: 'lanes sync [record-ref]',
});

export function collaborationCapability(enabled, error = null) {
  const state = error ? 'invalid' : enabled ? 'enabled' : 'disabled';
  return {
    enabled: error ? null : enabled,
    state,
    scope: 'project',
    remote_state: 'unknown',
    authentication: 'not_checked',
    hierarchy_capability: 'unknown_until_explicit_sync',
    network_access: error ? 'unavailable' : enabled ? 'explicit_sync_and_mutations' : 'disabled',
    automatic_mutation_sync: error ? null : enabled,
    mutations: {
      network_access: !error && enabled,
      trigger: 'goal_task_lane_track_mutations_when_enabled',
    },
    control: { command: COMMANDS.control, network_access: false, effect: 'project_config_only' },
    status: { command: COMMANDS.status, network_access: false },
    preview: { command: COMMANDS.preview, network_access: false },
    sync: {
      command: COMMANDS.sync,
      network_access: !error && enabled,
      requires_explicit_action: true,
    },
    ...(error ? { error } : {}),
  };
}

export function readCollaborationConfig(repoRoot) {
  const config = readConfig(repoRoot, { strict: true });
  if (typeof config.collaboration !== 'boolean') {
    throw new Error('collaboration configuration must be a boolean');
  }
  return config;
}

export function readCollaborationCapability(repoRoot) {
  try {
    const config = readCollaborationConfig(repoRoot);
    return collaborationCapability(config.collaboration);
  } catch (error) {
    return collaborationCapability(null, error.message);
  }
}
