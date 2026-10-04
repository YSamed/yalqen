export interface FlowVerificationView {
  result: 'passed' | 'failed';
  name: string;
  assertions: {
    summary: string;
    passed: boolean;
    actual: string | number | boolean | null;
    expected?: string | number;
    error?: string;
  }[];
  errors: string[];
}

function resultObject(output: string): Record<string, unknown> | null {
  if (output.length > 256 * 1024) return null;
  try {
    // Yalqen prefixes page-derived results with its untrusted-data notice.
    const start = output.startsWith('{') ? 0 : output.indexOf('\n\n') + 2;
    const value: unknown = JSON.parse(output.slice(start));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.content)) {
      const text = object.content.filter((item) => item?.type === 'text' && typeof item.text === 'string');
      if (text.length !== 1) return null;
      return resultObject(text[0].text);
    }
    return object;
  } catch {
    return null;
  }
}

export function verificationResult(output: string): 'passed' | 'failed' | null {
  const result = resultObject(output)?.result;
  return result === 'passed' || result === 'failed' ? result : null;
}

export function flowVerificationView(output: string): FlowVerificationView | null {
  const value = resultObject(output);
  if (
    !value ||
    (value.result !== 'passed' && value.result !== 'failed') ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.assertions) ||
    value.assertions.length > 20 ||
    !Array.isArray(value.errors) ||
    value.errors.some((error) => typeof error !== 'string')
  )
    return null;
  const assertions: FlowVerificationView['assertions'] = [];
  for (const item of value.assertions) {
    if (
      !item ||
      typeof item.summary !== 'string' ||
      typeof item.passed !== 'boolean' ||
      (item.actual !== null && !['string', 'number', 'boolean'].includes(typeof item.actual)) ||
      (item.expected !== undefined && !['string', 'number'].includes(typeof item.expected)) ||
      (item.error !== undefined && typeof item.error !== 'string')
    )
      return null;
    assertions.push({
      summary: item.summary,
      passed: item.passed,
      actual: item.actual,
      ...(item.expected !== undefined && { expected: item.expected }),
      ...(item.error !== undefined && { error: item.error }),
    });
  }
  return { result: value.result, name: value.name, assertions, errors: value.errors };
}
