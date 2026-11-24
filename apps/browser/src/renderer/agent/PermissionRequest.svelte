<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { AgentChatPermission } from '../../shared/agent';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import AgentMarkdown from './AgentMarkdown.svelte';

  let {
    request,
    onrespond,
  }: {
    request: AgentChatPermission;
    onrespond(allow: boolean, always: boolean, answers: Record<string, string> | undefined): void;
  } = $props();
  let answers: Record<string, string> = $state({});

  function select(question: string, value: string, multiple: boolean): void {
    const selected = (answers[question] ?? '').split(', ').filter(Boolean);
    const next = multiple
      ? (selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]).join(', ')
      : value;
    answers = { ...answers, [question]: next };
  }

  function respond(allow: boolean, always = false): void {
    onrespond(allow, always, Object.keys(answers).length ? { ...answers } : undefined);
  }
</script>

<div class="approval">
  <div class="approval-heading">
    <Icon name={request.questions.length ? 'info' : 'lock'} size={14} /><strong>
      {t(
        request.questions.length
          ? 'agentChat.question'
          : request.plan !== null
            ? 'agentChat.planReady'
            : 'agentChat.approval',
      )}
    </strong>
  </div>
  {#if request.questions.length}
    {#each request.questions as question (question.question)}
      <fieldset>
        <legend>{question.question}</legend>
        {#each question.options as option (option.label)}
          <label class="answer-option">
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={`${request.id}-${question.question}`}
              checked={(answers[question.question] ?? '').split(', ').includes(option.label)}
              onchange={() => select(question.question, option.label, question.multiSelect)}
            />
            <span>
              <strong>{option.label}</strong>{#if option.description}<small>{option.description}</small>{/if}
            </span>
          </label>
        {/each}
        <input
          class="free-answer"
          aria-label={question.question}
          placeholder={t('agentChat.otherAnswer')}
          value={answers[question.question] ?? ''}
          oninput={(event) => (answers = { ...answers, [question.question]: event.currentTarget.value })}
        />
      </fieldset>
    {/each}
  {:else if request.plan !== null}
    <div class="plan"><AgentMarkdown text={request.plan} /></div>
  {:else}
    <p>{request.title}</p>
    <pre>{request.input}</pre>
  {/if}
  <div class="approval-actions">
    <Button onclick={() => respond(false)}>{t('agentChat.deny')}</Button>
    {#if request.canAlwaysAllow}<Button onclick={() => respond(true, true)}>
        {t('agentChat.alwaysAllow')}
      </Button>{/if}
    <Button
      variant="primary"
      disabled={request.questions.some((question) => !answers[question.question]?.trim())}
      onclick={() => respond(true)}
    >
      {t(
        request.questions.length
          ? 'agentChat.answer'
          : request.plan !== null
            ? 'agentChat.approvePlan'
            : 'agentChat.allow',
      )}
    </Button>
  </div>
</div>

<style>
  pre {
    max-height: 180px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    border-top: 1px solid var(--page-divider);
    background: var(--surface-strong);
    color: var(--text-muted);
    font: var(--ai-mono) / 1.6 var(--ai-mono-font);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .approval {
    margin: 16px 0 4px;
    padding: 14px;
    border-radius: var(--ai-radius);
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .approval-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent);
    font-size: var(--ai-small);
  }
  .approval-heading strong {
    font-weight: 600;
  }
  .approval > p {
    margin: 10px 0 8px;
    font-size: var(--ai-text);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .approval pre {
    max-height: 150px;
    border: 1px solid var(--page-divider);
    border-radius: 8px;
  }
  .approval-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }
  fieldset {
    min-width: 0;
    margin: 12px 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    font-size: var(--ai-text);
    line-height: 1.5;
  }
  .answer-option {
    display: flex;
    gap: 8px;
    padding: 6px 0;
    font-size: var(--ai-small);
    line-height: 1.45;
  }
  .answer-option input {
    flex: none;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  .answer-option strong {
    font-weight: 500;
  }
  .answer-option small {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    line-height: 1.45;
  }
  .free-answer {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-md);
    margin-top: 6px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-strong);
    color: var(--text);
    font: inherit;
    font-size: var(--ai-small);
  }
  .plan {
    max-height: 320px;
    overflow-y: auto;
    margin: 6px 0 8px;
  }
  .free-answer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
