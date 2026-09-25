export const sessionIdentity = (user) => (user ? `${user.id}:${user.role}` : 'anonymous');
export const canOpenPage = (user, privatePage, adminPage) =>
  (!privatePage || Boolean(user)) && (!adminPage || user?.role === 'admin');
