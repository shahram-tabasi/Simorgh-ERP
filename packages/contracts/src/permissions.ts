/**
 * Permission catalog primitives (architecture §6.4).
 *
 * Every module declares its permissions in code with `definePermissions`; the
 * API syncs the union into core.permissions at boot. A key is
 * `<module>.<resource>.<action>` — the module prefix is added here, so a
 * module cannot declare a key in someone else's namespace.
 */
export type Scope = 'own' | 'org_unit' | 'project' | 'legal_entity' | 'tenant';
export const SCOPES: readonly Scope[] = ['own', 'org_unit', 'project', 'legal_entity', 'tenant'];

export interface PermissionSpec {
  fa: string;
  en: string;
  /** Scopes a role may grant this permission at. Default: tenant only. */
  scopes?: readonly Scope[];
}

export interface PermissionDef {
  key: string;
  module: string;
  labelFa: string;
  labelEn: string;
  scopes: Scope[];
}

const KEY_RE = /^[a-z_]+\.[a-z_]+\.[a-z_]+(\.[a-z_]+)?$/;

export function definePermissions<const K extends string>(
  module: string,
  specs: Record<K, PermissionSpec>,
): { [P in K]: `${typeof module}.${P}` } & { readonly all: PermissionDef[] } {
  const keys = {} as Record<string, string>;
  const all: PermissionDef[] = [];
  for (const [local, spec] of Object.entries(specs) as [K, PermissionSpec][]) {
    const key = `${module}.${local}`;
    if (!KEY_RE.test(key)) throw new Error(`invalid permission key "${key}"`);
    keys[local] = key;
    all.push({ key, module, labelFa: spec.fa, labelEn: spec.en, scopes: [...(spec.scopes ?? ['tenant'])] });
  }
  return Object.assign(keys, { all }) as never;
}
