<script lang="ts">
  import { t } from '../../shared/i18n';
  import type { AgentProjectSummary } from '../../shared/types';
  import IconButton from '../ui/IconButton.svelte';

  const MAX_PROJECTS = 6;

  let { projects, activeId }: { projects: AgentProjectSummary[]; activeId: string } = $props();

  const nameOf = (project: AgentProjectSummary) =>
    project.directory?.split('/').filter(Boolean).pop() ?? t('agentProjects.untitled');

  function select(id: string): void {
    if (id !== activeId) void window.yalqen.selectAgentProject(id).catch(() => false);
  }

  function selectByKeyboard(event: KeyboardEvent, index: number): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = projects[(index + (event.key === 'ArrowRight' ? 1 : -1) + projects.length) % projects.length];
    select(next.id);
    document.getElementById(`agent-project-${next.id}`)?.focus();
  }
</script>

<div class="projects">
  <div class="list" role="tablist" aria-label={t('agentProjects.label')}>
    {#each projects as project, index (project.id)}
      {@const active = project.id === activeId}
      {@const name = nameOf(project)}
      <div class="project" class:active>
        <button
          id="agent-project-{project.id}"
          role="tab"
          aria-selected={active}
          tabindex={active ? 0 : -1}
          title={[project.directory ?? name, project.waiting ? t('agentChat.waiting') : null]
            .filter(Boolean)
            .join('\n')}
          onclick={() => select(project.id)}
          onkeydown={(event) => selectByKeyboard(event, index)}
        >
          {#if project.busy || project.waiting}<span class="dot" class:waiting={project.waiting}></span>{/if}
          <span class="name">{name}</span>
        </button>
        {#if projects.length > 1 && !project.busy}
          <IconButton
            size="sm"
            icon="close"
            label={t('agentProjects.close', { name })}
            onclick={() => void window.yalqen.closeAgentProject(project.id).catch(() => false)}
          />
        {/if}
      </div>
    {/each}
  </div>
  {#if projects.length < MAX_PROJECTS}
    <IconButton
      size="sm"
      icon="plus"
      label={t('agentProjects.add')}
      onclick={() => void window.yalqen.newAgentProject().catch(() => false)}
    />
  {/if}
</div>

<style>
  .projects,
  .list,
  .project,
  .project button {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .projects {
    flex: none;
    gap: 4px;
    padding: 0 10px 8px var(--ai-gutter);
  }
  .list {
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .project {
    flex: 0 1 auto;
    max-width: 160px;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-size: var(--ai-small);
  }
  .project:hover {
    background: var(--surface-hover);
  }
  .project.active {
    background: var(--surface-hover);
    color: var(--text);
  }
  .project button {
    flex: 1;
    gap: 6px;
    height: var(--control-sm);
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .project button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .project :global(.icon-btn) {
    flex: none;
    margin-left: -6px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .dot.waiting {
    background: var(--warn);
  }
</style>
