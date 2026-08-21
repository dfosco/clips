<script>
  import Icon from './Icon.svelte';

  export let goal;
  export let onOpen = () => {};
  export let onOpenChange = () => {};

  $: sourceLabel = goal.source === 'github' ? 'GitHub linked' : 'Local only';
  $: statusLabel = (goal.status || 'open').replaceAll('_', ' ');

  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(goal);
    }
  }
</script>

<!-- The card contains an optional external link, so it remains an article with button semantics. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<article class="goal-card" role="button" tabindex="0" aria-label={`Open goal ${goal.title}`} onclick={() => onOpen(goal)} onkeydown={handleKeydown}>
  <div class="goal-card__topline">
    <span class="task-ref">{goal.ref}</span>
    <span class="status-pill"><span class="status-dot status-dot--{goal.status === 'in_progress' ? 'in_progress' : goal.status === 'closed' ? 'closed' : goal.status === 'not_planned' || goal.status === 'duplicate' ? 'not_planned' : 'open'}"></span>{statusLabel}</span>
  </div>
  <h3>{goal.title}</h3>
  {#if goal.description}<p>{goal.description}</p>{:else}<p class="goal-card__empty">No description provided.</p>{/if}
  <div class="goal-card__footer">
    <span class="source-label source-label--{goal.source}"><Icon name={goal.source === 'github' ? 'github' : 'bookmark'} size={16} />{sourceLabel}</span>
    <span class="verification-label">{goal.effective_verification_mode === 'behavior_and_tests' ? 'Behavior + tests' : 'Behavior'}</span>
    <span>{goal.tasks.length} {goal.tasks.length === 1 ? 'task' : 'tasks'}</span>
  </div>
  {#if goal.status === 'closed' && goal.closed_commit_sha}<div class="closed-commit"><Icon name="commit" size={14} /><span title={goal.closed_commit_sha}>Closed in <code>{goal.closed_commit_sha.slice(0, 7)}</code></span></div>{/if}
  {#if goal.linked_crs?.length}<div class="linked-crs"><span>CR</span>{#each goal.linked_crs as record}<button type="button" onclick={(event) => { event.stopPropagation(); onOpenChange(record); }}>{record.id}</button>{/each}</div>{/if}
</article>
