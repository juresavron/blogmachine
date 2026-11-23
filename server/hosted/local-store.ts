// The hosted build injects D1. It must never fall back to an ephemeral local file.
export function createStore(): never { throw new Error('Hosted database binding is required.'); }
