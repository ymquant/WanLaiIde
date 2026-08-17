export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const maskedName = name.length > 0 ? name[0] + "***" : "***";
  return `${maskedName}@${domain}`;
}
