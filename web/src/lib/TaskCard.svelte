<script>
  import Icon from './Icon.svelte';

  export let task;
  export let onOpen = () => {};
  export let onOpenChange = () => {};
  $: sourceLabel = task.source === 'github' ? 'GitHub linked' : 'Local only';
  $: goalStatusLabel = task.goal_status?.replace('_', ' ') || 'open';

  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task);
    }
  }
</script>

<!-- The card contains an optional external link, so it remains an article with button semantics. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<article class="task-card" role="button" tabindex="0" aria-label={`Open task ${task.title}`} onclick={() => onOpen(task)} onkeydown={handleKeydown}>
  <div class="task-card__topline">
    <span class="task-ref">{task.ref}</span>
    <span class="status-dot status-dot--{task.column}" aria-label={task.status}></span>
  </div>
  <h3>{task.title}</h3>
  <p class="task-goal">Goal: {task.goal_title} · {goalStatusLabel}</p>
  {#if task.description}<p class="task-description">{task.description}</p>{/if}
  <div class="task-card__footer">
    {#if task.issue_url}
      <a class="source-link" href={task.issue_url} target="_blank" rel="noreferrer" onclick={(event) => event.stopPropagation()}><Icon name="github" size={16} />{sourceLabel}</a>
    {:else}
      <span class="source-label source-label--{task.source}"><Icon name={task.source === 'github' ? 'github' : 'bookmark'} size={16} />{sourceLabel}</span>
    {/if}
    <span class="verification-label">{task.effective_verification_mode === 'behavior_and_tests' ? 'Behavior + tests' : 'Behavior'}</span>
  </div>
  {#if task.status === 'closed' && task.closed_commit_sha}<div class="closed-commit"><Icon name="commit" size={14} /><span title={task.closed_commit_sha}>Closed in <code>{task.closed_commit_sha.slice(0, 7)}</code></span></div>{/if}
  {#if task.linked_crs?.length}<div class="linked-crs"><span>CR</span>{#each task.linked_crs as record}<button type="button" onclick={(event) => { event.stopPropagation(); onOpenChange(record); }}>{record.id}</button>{/each}</div>{/if}
</article>
