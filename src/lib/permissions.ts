/**
 * Permission system — granular permissions assigned to admin users via CSV in DB.
 */

export const PERMISSIONS = {
  MANAGE_TOURNAMENTS: 'MANAGE_TOURNAMENTS',
  MANAGE_PLAYERS: 'MANAGE_PLAYERS',
  MANAGE_RESULTS: 'MANAGE_RESULTS',
  MANAGE_USERS: 'MANAGE_USERS',
  VIEW_ADMIN_PANEL: 'VIEW_ADMIN_PANEL',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/**
 * Default permission sets for common roles.
 */
export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  MODERATOR: [
    PERMISSIONS.VIEW_ADMIN_PANEL,
    PERMISSIONS.MANAGE_TOURNAMENTS,
    PERMISSIONS.MANAGE_PLAYERS,
    PERMISSIONS.MANAGE_RESULTS,
  ],
  AUDITOR: [PERMISSIONS.VIEW_ADMIN_PANEL, PERMISSIONS.VIEW_AUDIT_LOGS],
};

export function parsePermissions(csv: string): Permission[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((p) => p.trim())
    .filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));
}

export function serializePermissions(perms: Permission[]): string {
  return [...new Set(perms)].join(',');
}

export function hasPermission(userPerms: Permission[], required: Permission): boolean {
  return userPerms.includes(required);
}
