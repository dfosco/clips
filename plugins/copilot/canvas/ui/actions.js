// One serialized mutation stream. Old refresh responses cannot change selection.
export function createActions({ call, onState, onError, onPending, onNotice }) {
  let state;
  let navigation = 0;
  let refresh = 0;
  let pending = 0;
  let queue = Promise.resolve();
  async function run(action, input, version, refreshId, project) {
    try {
      const selectionAction = ['refresh', 'set_project', 'initialize_current_directory'].includes(action);
      if (!selectionAction && state?.projectPath !== project) throw new Error('The selected Clips project changed before this action ran. Review it before acting.');
      const result = await call(action, selectionAction ? input : { ...input, expectedProjectPath: project });
      if (action === 'refresh' && (version !== navigation || refreshId !== refresh)) return null;
      state = result?.state || (action === 'refresh' || action === 'set_project' ? result : await call('refresh'));
      onState(state);
      if (action === 'launch' || action === 'steer') onNotice?.('Message sent through the current joined Copilot session.');
      return result;
    } catch (error) {
      if (action === 'refresh' && (version !== navigation || refreshId !== refresh)) return null;
      // Do not leave a formerly selected project's board visible after a failed reread.
      if (action === 'refresh') { state = undefined; onState(null); }
      if (action === 'launch') {
        try { state = await call('refresh'); onState(state); } catch { state = undefined; onState(null); }
      }
      onError(error.message);
      return null;
    }
  }
  return { act(action, input = {}) {
    if (action === 'refresh') return pending ? Promise.resolve(null) : run(action, input, navigation, ++refresh);
    if (action === 'launch' && pending) return Promise.resolve(null);
    ++navigation; ++pending; onPending(pending);
    const project = state?.projectPath;
    const work = queue.then(() => run(action, input, undefined, undefined, project));
    queue = work.catch(() => {});
    return work.finally(() => { --pending; onPending(pending); });
  } };
}
