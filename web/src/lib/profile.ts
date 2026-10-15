const ROLE_LABEL: Record<string, string> = { DRIVER: "Driver", RIDER: "Rider", ADMIN: "Admin" };

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export function roleSummary(roles: readonly string[]): string {
  return roles.map(roleLabel).join(" · ");
}

// First letter of the name for the avatar circle ("?" when the name is blank).
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
