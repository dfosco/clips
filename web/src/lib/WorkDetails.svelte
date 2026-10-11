<script>
  import MarkdownContent from './MarkdownContent.svelte';
  import EvidenceValue from './EvidenceValue.svelte';

  export let record;
  export let kind = 'task';
  export let components = [];
  export let onOpenComponent = () => {};

  $: criteria = (record.acceptance_criteria || []).map((criterion, index) => typeof criterion === 'string'
    ? { id: `A${index + 1}`, description: criterion }
    : criterion);
  function assessment(id) {
    return record.acceptance?.criteria?.find((criterion) => criterion.id === id);
  }
</script>

{#if record.description}
  <section class="detail-section">
    <h3>{kind === 'task' ? 'Change request' : 'Outcome'}</h3>
    <MarkdownContent source={record.description} />
  </section>
{/if}

{#each [['Scope', 'scope'], ...(kind === 'goal' ? [['Plan', 'plan'], ['Decisions', 'decisions']] : [])] as [heading, field]}
  {#if record[field]}
    <section class="detail-section"><h3>{heading}</h3><MarkdownContent source={record[field]} /></section>
  {/if}
{/each}

{#if (record.component_refs || record.components)?.length}
  <section class="detail-section">
    <h3>Components</h3>
    <ul class="reference-list">
      {#each record.component_refs || record.components as ref}
        {@const component = components.find((candidate) => candidate.ref === ref)}
        <li>{#if component}<button type="button" onclick={() => onOpenComponent(component)}>{ref} · {component.title}</button>{:else}<code>{ref}</code>{/if}</li>
      {/each}
    </ul>
  </section>
{/if}

{#if record.blocked_by?.length}
  <section class="detail-section"><h3>Work dependencies</h3><ul class="reference-list">{#each record.blocked_by as ref}<li><code>{ref}</code></li>{/each}</ul></section>
{/if}

{#if record.owner || record.acceptance_owner}
  <dl class="work-ownership">
    {#if record.owner}<div><dt>Owner</dt><dd>{record.owner}</dd></div>{/if}
    {#if record.acceptance_owner}<div><dt>Acceptance owner</dt><dd>{record.acceptance_owner}</dd></div>{/if}
  </dl>
{/if}

{#if criteria.length}
  <section class="detail-section">
    <h3>Acceptance criteria</h3>
    <ol class="acceptance-criteria">
      {#each criteria as criterion (criterion.id)}
        {@const result = assessment(criterion.id)}
        <li>
          <div class="criterion-header"><code>{record.ref}#{criterion.id}</code>{#if result}<span class="criterion-status">{result.status}</span>{/if}</div>
          <MarkdownContent source={criterion.description} />
          {#if result?.evidence || criterion.evidence}<div class="criterion-evidence"><h4>Evidence</h4><EvidenceValue value={result?.evidence || criterion.evidence} /></div>{/if}
          {#if result?.reason}<div class="criterion-evidence"><h4>Waiver reason</h4><MarkdownContent source={result.reason} /></div>{/if}
        </li>
      {/each}
    </ol>
  </section>
{/if}

{#if record.record}
  <section class="detail-section"><h3>Change record</h3><MarkdownContent source={record.record} /></section>
{/if}

{#if record.acceptance}
  <section class="detail-section acceptance-receipt">
    <h3>Acceptance</h3>
    <MarkdownContent source={record.acceptance.summary} />
    <dl class="work-ownership">
      <div><dt>Accepted by</dt><dd>{record.acceptance.accepted_by}</dd></div>
      {#if record.acceptance.accepted_at}<div><dt>Accepted at</dt><dd>{record.acceptance.accepted_at}</dd></div>{/if}
      {#if record.acceptance.request_revision}<div><dt>Request revision</dt><dd>r{record.acceptance.request_revision}</dd></div>{/if}
    </dl>
    <h4>Accepted artifact</h4>
    <EvidenceValue value={record.acceptance.artifact} />
    {#if record.acceptance.component_basis?.length}<h4>Accepted component revisions</h4><ul class="reference-list">{#each record.acceptance.component_basis as ref}<li><code>{ref}</code></li>{/each}</ul>{/if}
    {#if record.acceptance.exceptions?.length}<h4>Acceptance exceptions</h4><ul>{#each record.acceptance.exceptions as exception}<li><code>{exception.ref}</code> — {exception.reason}</li>{/each}</ul>{/if}
    {#if record.acceptance.request_snapshot}<details class="record-extra"><summary>Accepted request snapshot</summary><EvidenceValue value={record.acceptance.request_snapshot} /></details>{/if}
  </section>
{/if}

{#if record.acceptance_history?.length}
  <details class="detail-section record-extra">
    <summary>Previous acceptance ({record.acceptance_history.length})</summary>
    {#each record.acceptance_history as receipt}
      <div class="previous-acceptance">
        <p>{receipt.accepted_by} · {receipt.accepted_at}</p>
        {#if receipt.invalidation_reason}<MarkdownContent source={receipt.invalidation_reason} />{/if}
        <EvidenceValue value={receipt.artifact} />
      </div>
    {/each}
  </details>
{/if}

{#each Object.entries(record.sections || {}) as [heading, markdown]}
  <section class="detail-section"><h3>{heading}</h3><MarkdownContent source={markdown} /></section>
{/each}

{#if Object.keys(record.extensions || {}).length}
  <details class="detail-section record-extra"><summary>Extensions</summary><EvidenceValue value={record.extensions} /></details>
{/if}
