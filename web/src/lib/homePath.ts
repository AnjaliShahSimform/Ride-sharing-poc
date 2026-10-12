// Where an account lands after login/signup and from "/". Only a RIDER can
// book a ride, so only a RIDER gets the search page as home: a driver-only
// account lands on its own rides, and an admin-only account (neither DRIVER
// nor RIDER) on the admin users list.
export function homePathFor(roles: readonly string[] = []): string {
  const isAdminOnly = roles.length === 1 && roles[0] === "ADMIN";
  if (isAdminOnly) return "/admin/users";
  if (roles.includes("DRIVER") && !roles.includes("RIDER")) return "/rides/mine";
  return "/rides";
}
