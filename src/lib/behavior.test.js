import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERIFICATION_MODE,
  effectiveVerificationMode,
  planningBehaviorFields,
} from './behavior.js';

describe('planning behavior', () => {
  it('defaults new goals to behavior mode without requiring behavior text', () => {
    expect(planningBehaviorFields({}, { defaultMode: true })).toEqual({
      verification_mode: DEFAULT_VERIFICATION_MODE,
    });
  });

  it('accepts both verification modes and preserves raw behavior text', () => {
    expect(planningBehaviorFields({
      behavior: 'Scenario: Add a to-do',
      verification_mode: 'behavior_and_tests',
    })).toEqual({
      behavior: 'Scenario: Add a to-do',
      verification_mode: 'behavior_and_tests',
    });
  });

  it('rejects unknown modes and non-string behavior', () => {
    expect(() => planningBehaviorFields({ verification_mode: 'tdd' }))
      .toThrow('Invalid verification_mode');
    expect(() => planningBehaviorFields({ behavior: ['Scenario'] }))
      .toThrow('behavior must be a string');
  });

  it('inherits the goal mode until a task overrides it', () => {
    expect(effectiveVerificationMode('behavior_and_tests')).toBe('behavior_and_tests');
    expect(effectiveVerificationMode('behavior_and_tests', 'behavior')).toBe('behavior');
    expect(effectiveVerificationMode(undefined, undefined)).toBe('behavior');
  });

  it('allows a task update to clear its override', () => {
    expect(planningBehaviorFields(
      { verification_mode: null },
      { allowInheritedMode: true },
    )).toEqual({ verification_mode: null });
  });
});
