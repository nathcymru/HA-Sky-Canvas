// HA installs its scoped custom-element registry before defining home-assistant.
// Extra modules can run earlier, so even importing Lit/components must wait:
// definitions made in the original native registry are invisible after replacement.
await customElements.whenDefined("home-assistant");
await import("./main");
export {};
