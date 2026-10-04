// WebMCP lets a page offer tools to agents through navigator.modelContext. Chromium does not ship it
// by default, so observed local pages get this small stand-in when the API is missing. It runs in
// the page's own world because the page is the one registering tools.
export const WEBMCP_SCRIPT = `(() => {
  if ('modelContext' in navigator) return;
  const tools = new Map();
  const register = (tool) => {
    if (!tool || typeof tool.name !== 'string' || typeof tool.execute !== 'function') {
      throw new TypeError('A tool needs a name and an execute function');
    }
    tools.set(tool.name, tool);
    return { unregister: () => tools.delete(tool.name) };
  };
  const modelContext = {
    provideContext(context = {}) {
      tools.clear();
      for (const tool of context.tools || []) register(tool);
    },
    registerTool: register,
    unregisterTool(name) {
      tools.delete(name);
    },
    clearContext() {
      tools.clear();
    },
  };
  Object.defineProperty(modelContext, '__yalqenTools', {
    value: {
      list: () => [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      call: (name, input) => {
        const tool = tools.get(name);
        if (!tool) throw new Error('The page has no tool named ' + name);
        return tool.execute(input, { requestUserInteraction: (callback) => callback() });
      },
    },
  });
  Object.defineProperty(navigator, 'modelContext', { value: modelContext, configurable: true });
})();`;

export const LIST_PAGE_TOOLS = `navigator.modelContext && navigator.modelContext.__yalqenTools
  ? navigator.modelContext.__yalqenTools.list()
  : null`;

export function callPageToolExpression(name: string, input: unknown): string {
  return `navigator.modelContext.__yalqenTools.call(${JSON.stringify(name)}, ${JSON.stringify(input ?? {})})`;
}

interface PageTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const MAX_RESULT_CHARS = 64 * 1024;

export function sanitizePageTools(value: unknown): PageTool[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
    .filter((tool) => typeof tool.name === 'string')
    .slice(0, 100)
    .map((tool) => ({
      name: String(tool.name).slice(0, 200),
      description: typeof tool.description === 'string' ? tool.description.slice(0, 2000) : undefined,
      inputSchema: tool.inputSchema,
    }));
}

export function pageToolResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}
