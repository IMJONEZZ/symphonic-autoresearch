/**
 * Resolve $VAR_NAME references in config values to environment variable values.
 * Returns the original value if it doesn't start with $.
 * Returns empty string if the env var is not set or empty.
 */
export function resolveEnvVar(value: string): string {
  if (!value.startsWith("$")) return value;
  const varName = value.slice(1);
  return process.env[varName] ?? "";
}
