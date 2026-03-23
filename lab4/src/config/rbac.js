/**
 * RBAC Engine: роли и права с наследованием (без сторонних библиотек).
 * Роли: user → manager → admin (каждая наследует права предыдущей).
 */

const ROLE_HIERARCHY = ['user', 'manager', 'admin'];

const ROLE_PERMISSIONS = {
  user: [
    'tasks:create',
    'tasks:read:own',
    'tasks:update:own',
    'tasks:delete:own'
  ],
  manager: [
    'tasks:read:any',
    'tasks:status:update:any',
    'users:read'
  ],
  admin: [
    'tasks:delete:any',
    'users:role:update',
    'users:deactivate'
  ]
};

function getRoleIndex(role) {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * Возвращает полный список прав для роли с учётом наследования.
 * @param {string} role
 * @returns {string[]}
 */
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

function hasRoleAtLeast(userRole, minRole) {
  const userIdx = getRoleIndex(userRole);
  const minIdx = getRoleIndex(minRole);
  return userIdx !== -1 && minIdx !== -1 && userIdx >= minIdx;
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  getRoleIndex,
  getPermissionsForRole,
  hasRoleAtLeast
};
