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

// "+919876543210" -> "+91 ••••• ••210"; a legacy "9000000003" -> "••••• ••003".
export function maskPhone(phone: string): string {
  const tail = `••••• ••${phone.slice(-3)}`;
  return phone.startsWith("+91") ? `+91 ${tail}` : tail;
}
