<script>
  import Icon from './Icon.svelte';

  export let task;
  export let onOpen = () => {};
  $: sourceLabel = task.source === 'github' ? 'GitHub linked' : 'Local only';
  $: goalStatusLabel = task.goal_status?.replace('_', ' ') || 'open';

  function handleKeydown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task);
    }
  }
</script>

<!-- The card contains an optional external link, so it remains an article with button semantics. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<article class="task-card" role="button" tabindex="0" aria-label={`Open task ${task.title} in ${task.project_label}`} onclick={() => onOpen(task)} onkeydown={handleKeydown}>
  <div class="task-card__topline">
    <span class="task-ref">{task.ref}</span>
    <span class="status-dot status-dot--{task.column}" aria-label={task.status}></span>
  </div>
  <h3>{task.title}</h3>
  <p class="task-goal">Project: {task.project_label} · Goal: {task.goal_title} · {goalStatusLabel}</p>
  <div class="task-card__footer">
    <span class="source-label source-label--{task.source}"><Icon name={task.source === 'github' ? 'github' : 'bookmark'} size={16} />{sourceLabel}</span>
    <span class="verification-label">{task.effective_verification_mode === 'behavior_and_tests' ? 'Behavior + tests' : 'Behavior'}</span>
  </div>
  {#if task.status === 'closed' && task.closed_commit_sha}<div class="closed-commit"><Icon name="commit" size={14} /><span title={task.closed_commit_sha}>Closed in <code>{task.closed_commit_sha.slice(0, 7)}</code></span></div>{/if}
  {#if task.linked_crs?.length}<div class="linked-crs"><span>CR</span>{#each task.linked_crs as record}<button type="button">{record.id}</button>{/each}</div>{/if}
</article>
