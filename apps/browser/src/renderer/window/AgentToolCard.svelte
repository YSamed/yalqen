<script lang="ts">
  import { t, type MessageKey } from '../../shared/i18n';
  import { fileChange, relativePath } from '../../shared/file-change';
  import type { AgentChatPart } from '../../shared/types';
  import { flowVerificationView } from '../../shared/verification-result';
  import Icon from '../ui/Icon.svelte';

  let { part, directory }: { part: Extract<AgentChatPart, { type: 'tool' }>; directory: string | null } = $props();

  const change = $derived(part.status === 'error' ? null : fileChange(part.name, part.input));
  const flow = $derived(
    part.status === 'done' && /(?:^|__)run_flow$/.test(part.name) ? flowVerificationView(part.output) : null,
  );
  const file = $derived(change ? relativePath(change.path, directory) : null);
  const running = $derived(part.task ? part.task.status === 'running' : part.status === 'running');
  const failed = $derived(
    part.status === 'error' ||
      part.verification === 'failed' ||
      flow?.result === 'failed' ||
      part.task?.status === 'failed',
  );
  const label = $derived(
    flow
      ? t('browserChecks.flowTool')
      : (file ?? (part.task?.description || part.name.replace(/^mcp__yalqen__/, 'Yalqen · '))),
  );
  const status: MessageKey = $derived.by(() => {
    if (part.verification === 'passed' || flow?.result === 'passed') return 'agentChat.verified';
    if (part.verification === 'failed' || flow?.result === 'failed') return 'agentChat.notVerified';
    const state = part.task?.status ?? part.status;
    if (state === 'done' || state === 'completed') return 'agentChat.toolDone';
    if (state === 'error' || state === 'failed') return 'agentChat.toolError';
    if (state === 'stopped') return 'agentChat.toolStopped';
    return 'agentChat.toolRunning';
  });

  function open(): void {
    if (change) void window.yalqen.openAgentFile(change.path).catch(() => undefined);
  }
</script>

<details
  class="tool"
  class:failed
  class:verified={part.verification === 'passed' || flow?.result === 'passed'}
  class:subagent={part.task !== null || part.steps.length > 0}
>
  <summary>
    <Icon name={failed ? 'warning' : running ? 'code' : 'check'} size={14} />
    <span class="label">
      <span class="name" title={change?.path}>{label}</span>
      {#if running && part.steps.length}<span class="step">{part.steps.at(-1)}</span>{/if}
    </span>
    {#if change}<span class="counts"
        ><span class="added">+{change.added}</span> <span class="removed">−{change.removed}</span></span
      >{/if}
    {#if part.task?.toolUses}<span class="counts">{t('agentChat.toolUses', { count: part.task.toolUses })}</span>{/if}
    <span class="status">{t(status)}</span>
    <Icon name="down" size={12} />
  </summary>
  {#if change}
    <div class="file-bar">
      <button type="button" class="file" title={t('agentChat.openFile', { file: file ?? '' })} onclick={open}
        >{file}</button
      >
    </div>
    <div class="diff" role="table" aria-label={file}>
      {#each change.lines as line, index (index)}
        <div class="line {line.kind}" role="row">
          <span class="sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span
          >{line.text}
        </div>
      {/each}
      {#if change.truncated}<div class="line more">{t('agentChat.diffTruncated')}</div>{/if}
    </div>
  {:else if flow}
    <div class="flow-results">
      <p>{flow.name}</p>
      <ul aria-label={t('browserChecks.assertions')}>
        {#each flow.assertions as assertion, index (index)}
          <li class:assertion-failed={!assertion.passed}>
            <Icon name={assertion.passed ? 'check' : 'warning'} size={14} />
            <div>
              <strong>{assertion.summary}</strong>
              {#if assertion.expected !== undefined}<span
                  >{t('browserChecks.expectedValue', { value: String(assertion.expected) })}</span
                >{/if}
              <span
                >{t('browserChecks.actual', {
                  value: assertion.actual === null ? '—' : String(assertion.actual),
                })}</span
              >
              {#if assertion.error}<span>{assertion.error}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
      {#each flow.errors as error, index (index)}<p class="assertion-failed">{error}</p>{/each}
    </div>
    <pre>{part.input}</pre>
  {:else}
    {#if part.task?.summary}<p class="summary-text">{part.task.summary}</p>{/if}
    {#if part.steps.length}
      <ol class="steps">
        {#each part.steps as step, index (index)}<li>{step}</li>{/each}
      </ol>
    {/if}
    <pre>{part.input}</pre>
    {#if part.output}<pre class="output">{part.output}</pre>{/if}
  {/if}
</details>

<style>
  .tool {
    margin: 8px 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .flow-results {
    padding: 0 12px 8px;
    font-size: var(--ai-meta);
    overflow-wrap: anywhere;
  }
  .flow-results ul {
    display: grid;
    gap: 10px;
    padding: 0;
    list-style: none;
  }
  .flow-results li {
    display: flex;
    gap: 8px;
    color: var(--success);
  }
  .flow-results li > :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .flow-results li > div {
    display: grid;
    gap: 3px;
    color: var(--text-muted);
  }
  .flow-results strong {
    color: var(--text);
    font-weight: 500;
  }
  .flow-results .assertion-failed {
    color: var(--warn);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 4px 10px 4px 12px;
    color: var(--text-muted);
    font-size: var(--ai-small);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: var(--surface-hover);
  }
  summary:focus-visible,
  .file:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  summary > :global(svg) {
    flex: none;
  }
  .failed summary {
    color: var(--warn);
  }
  .verified summary {
    color: var(--success);
  }
  .label {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .name,
  .step {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    color: var(--text);
  }
  .step {
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  .counts,
  .status {
    flex: none;
  }
  .counts {
    font-size: var(--ai-meta);
    font-variant-numeric: tabular-nums;
  }
  .status {
    font-size: var(--ai-meta);
  }
  .added {
    color: var(--success);
  }
  .removed {
    color: var(--warn);
  }
  .file-bar {
    padding: 6px 12px;
    border-top: 1px solid var(--page-divider);
  }
  .file {
    max-width: 100%;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: none;
    color: var(--accent);
    font: var(--ai-meta) / 1.5 var(--ai-mono-font);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .file:hover {
    text-decoration: underline;
  }
  .diff {
    max-height: 260px;
    overflow: auto;
    background: var(--surface-strong);
    font: var(--ai-meta) / 1.6 var(--ai-mono-font);
    user-select: text;
  }
  .line {
    padding: 0 10px 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sign {
    display: inline-block;
    width: 20px;
    text-align: center;
    user-select: none;
  }
  .line.add {
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }
  .line.remove {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .line.same,
  .line.more {
    color: var(--text-muted);
  }
  .line.more {
    padding-left: 20px;
  }
  .summary-text {
    margin: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--page-divider);
    font-size: var(--ai-small);
    line-height: 1.5;
  }
  .steps {
    max-height: 180px;
    margin: 0;
    padding: 8px 12px 8px 32px;
    overflow: auto;
    border-top: 1px solid var(--page-divider);
    color: var(--text-muted);
    font-size: var(--ai-meta);
    line-height: 1.6;
  }
  .steps li {
    overflow-wrap: anywhere;
  }
  pre {
    max-height: 180px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    border-top: 1px solid var(--page-divider);
    background: var(--surface-strong);
    color: var(--text-muted);
    font: var(--ai-meta) / 1.6 var(--ai-mono-font);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .output {
    color: var(--text);
  }
</style>
