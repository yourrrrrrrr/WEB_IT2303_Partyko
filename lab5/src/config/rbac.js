/**
 * RBAC: 4 роли reader → author → editor → admin, иерархия прав по методичке.
 */

const ROLE_HIERARCHY = ['reader', 'author', 'editor', 'admin'];

const ROLE_PERMISSIONS = {
  reader: [
    'articles:read',
    'comments:create',
    'comments:delete:own'
  ],
  author: [
    'articles:create',
    'articles:update:own',
    'articles:delete:own'
  ],
  editor: [
    'articles:update:any',
    'articles:publish',
    'comments:delete:any',
    'users:read'
  ],
  admin: [
    'articles:delete:any',
    'users:manage'
  ]
};

function getRoleIndex(role) {
  return ROLE_HIERARCHY.indexOf(role);
}

function getPermissionsForRole(role) {
  const idx = getRoleIndex(role);
  if (idx === -1) return [];
  const set = new Set();
  for (let i = 0; i <= idx; i++) {
    const r = ROLE_HIERARCHY[i];
    (ROLE_PERMISSIONS[r] || []).forEach(p => set.add(p));
  }
  return Array.from(set);
}

function hasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  getRoleIndex,
  getPermissionsForRole,
  hasPermission
};
