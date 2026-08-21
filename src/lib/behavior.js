export const VERIFICATION_MODES = Object.freeze([
  'behavior',
  'behavior_and_tests',
]);

export const DEFAULT_VERIFICATION_MODE = 'behavior';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isVerificationMode(value) {
  return VERIFICATION_MODES.includes(value);
}

export function planningBehaviorFields(data = {}, options = {}) {
  const { defaultMode = false, allowInheritedMode = false } = options;
  const fields = {};

  if (hasOwn(data, 'behavior')) {
    if (typeof data.behavior !== 'string') {
      throw new Error('behavior must be a string');
    }
    fields.behavior = data.behavior;
  }

  if (hasOwn(data, 'verification_mode')) {
    if (allowInheritedMode && data.verification_mode === null) {
      fields.verification_mode = null;
    } else if (!isVerificationMode(data.verification_mode)) {
      throw new Error(`Invalid verification_mode. Valid: ${VERIFICATION_MODES.join(', ')}`);
    } else {
      fields.verification_mode = data.verification_mode;
    }
  } else if (defaultMode) {
    fields.verification_mode = DEFAULT_VERIFICATION_MODE;
  }

  return fields;
}

export function effectiveVerificationMode(goalMode, taskMode) {
  if (isVerificationMode(taskMode)) return taskMode;
  if (isVerificationMode(goalMode)) return goalMode;
  return DEFAULT_VERIFICATION_MODE;
}
