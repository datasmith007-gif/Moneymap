/** The account suffix safe and useful enough to show beside a bank name. */
export function accountLastFour(identifierMasked: string): string {
  const digits = identifierMasked.replace(/\D/g, '');
  return (digits || identifierMasked).slice(-4);
}

/** One consistent account label for every user-facing surface. */
export function formatAccountLabel(institution: string, identifierMasked: string): string {
  return `${institution} ${accountLastFour(identifierMasked)}`;
}
