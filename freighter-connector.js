/* ============================================================
   Freighter connector — resilient bridge for app.js

   Why this exists:
     Freighter's API has changed shape several times, and the
     vendored SDK (freighter-api v6) only speaks the newest
     protocol. Depending on the user's extension version the
     bridge may answer as:
       - v6 SDK:   getAddress()   -> { address }
                   signTransaction -> { signedTxXdr }
       - v5/older SDK or native extension API:
                   getPublicKey() -> "G..." or { publicKey }
                   signTransaction -> "xdr..." or { signedTransaction }
     This connector tries the SDK first, falls back to the
     legacy extension-injected API, and unwraps every known
     response shape into plain values.
   ============================================================ */
(function () {
  const sdk = window.freighterApi;
  const native = window.__nativeFreighter || null;

  // ---- Response normalizers -------------------------------------------
  // FreighterApiError is an object { code, message, ext }; plain strings and
  // Error instances also occur. Make every shape human-readable.
  function formatError(e) {
    if (!e) return 'unknown error';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    if (typeof e === 'object') {
      const parts = [];
      if (e.message) parts.push(e.message);
      if (e.code !== undefined) parts.push(`(code ${e.code})`);
      if (Array.isArray(e.ext) && e.ext.length) parts.push(e.ext.join(', '));
      if (parts.length) return parts.join(' ');
      try { return JSON.stringify(e); } catch { return String(e); }
    }
    return String(e);
  }

  function pickAddress(result) {
    if (!result) return null;
    if (typeof result === 'string') return result;
    if (typeof result.address === 'string' && result.address) return result.address;
    if (typeof result.publicKey === 'string' && result.publicKey) return result.publicKey;
    return null;
  }

  function pickSignedXdr(result) {
    if (!result) return null;
    if (typeof result === 'string') return result;
    if (typeof result.signedTxXdr === 'string' && result.signedTxXdr) return result.signedTxXdr;
    if (typeof result.signedTransaction === 'string' && result.signedTransaction) return result.signedTransaction;
    if (typeof result.xdr === 'string' && result.xdr) return result.xdr;
    return null;
  }

  // Run one address attempt; returns the address string or { error }.
  async function attemptAddress(fn, label) {
    try {
      const result = await fn();
      const addr = pickAddress(result);
      if (addr) return addr;
      const detail = (result && result.error) ? `: ${formatError(result.error)}` : ` (raw: ${JSON.stringify(result)})`;
      return { error: `${label} returned no address${detail}` };
    } catch (err) {
      return { error: `${label} failed: ${formatError(err)}` };
    }
  }

  window.freighterConnect = {
    isAvailable() {
      return Boolean(sdk || (native && typeof native.getPublicKey === 'function'));
    },

    // Tries SDK (getAddress or legacy getPublicKey), then native legacy API.
    async getAddress() {
      let lastError = 'Freighter not available';
      if (sdk) {
        const fn = typeof sdk.getAddress === 'function'
          ? () => sdk.getAddress()
          : () => sdk.getPublicKey();
        let r = await attemptAddress(fn, 'Freighter SDK');
        if (typeof r === 'string') return r;
        lastError = r.error;
        // v6 returns { address: "" } for sites the user has not approved yet.
        // requestAccess() opens the connection popup; after approval the
        // address becomes readable.
        if (typeof sdk.requestAccess === 'function') {
          r = await attemptAddress(() => sdk.requestAccess(), 'Freighter SDK (requestAccess)');
          if (typeof r === 'string') return r;
          lastError = r.error;
        }
      }
      if (native && typeof native.getPublicKey === 'function') {
        const r = await attemptAddress(() => native.getPublicKey(), 'Freighter (legacy)');
        if (typeof r === 'string') return r;
        lastError = r.error;
      }
      throw new Error(lastError || 'No wallet address returned');
    },

    // SDK first; only fall back to native if the SDK reports a protocol
    // error (not on cancellations, so the user is never double-prompted).
    async signTransaction(unsignedXdr, { networkPassphrase } = {}) {
      if (sdk && typeof sdk.signTransaction === 'function') {
        let result;
        try {
          result = await sdk.signTransaction(unsignedXdr, { networkPassphrase });
        } catch (err) {
          // Thrown = user cancelled or extension-level failure; don't retry.
          throw new Error(formatError(err));
        }
        const signed = pickSignedXdr(result);
        if (signed) return signed;
        if (result && result.error) {
          // Protocol-level error — maybe an old extension; try legacy path.
          if (native && typeof native.signTransaction === 'function') {
            const legacy = await native.signTransaction(unsignedXdr, networkPassphrase);
            const legacySigned = pickSignedXdr(legacy);
            if (legacySigned) return legacySigned;
            if (legacy && legacy.error) throw new Error(formatError(legacy.error));
          }
          throw new Error(formatError(result.error));
        }
        throw new Error('Freighter returned no signed transaction');
      }
      if (native && typeof native.signTransaction === 'function') {
        const legacy = await native.signTransaction(unsignedXdr, networkPassphrase);
        const signed = pickSignedXdr(legacy);
        if (signed) return signed;
        throw new Error((legacy && legacy.error) || 'Freighter returned no signed transaction');
      }
      throw new Error('No Freighter signing API available');
    }
  };
})();
