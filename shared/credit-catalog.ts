// The only review-credit packages the application will sell or fulfil.
// Stripe metadata is never trusted on its own: a price must be allow-listed
// (STRIPE_CREDIT_PRICES) AND its amount and credits must match this catalog exactly.
export const CREDIT_PACKAGES = [
  { credits: 1, unitAmount: 499, name: "Single Review", description: "1 paper review credit" },
  { credits: 5, unitAmount: 1999, name: "5 Review Pack", description: "5 paper review credits - Save 20%" },
  { credits: 10, unitAmount: 3499, name: "10 Review Pack", description: "10 paper review credits - Save 30%" },
  { credits: 25, unitAmount: 7499, name: "25 Review Bundle", description: "25 paper review credits - Save 40%" },
] as const;

export const CREDIT_CURRENCY = "usd";

export function catalogPackage(credits: number) {
  return CREDIT_PACKAGES.find((p) => p.credits === credits);
}
