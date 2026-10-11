<script>
  import MarkdownContent from './MarkdownContent.svelte';
  export let value;
</script>

{#if typeof value === 'string'}
  <MarkdownContent source={value} />
{:else if value != null}
  <pre class="evidence-json"><code>{JSON.stringify(value, null, 2)}</code></pre>
{/if}
