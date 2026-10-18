(() => {
  let sent = false;
  let previousState = "";
  let lastStateAt = 0;

  async function collectHostedCode() {
    try {
      const token =
        new URLSearchParams(window.location.search).get("mirrorToken") ||
        window.sessionStorage.getItem("playarr.debugMirrorToken");
      if (!token) return;

      const activeProfile = window.localStorage.getItem("playarr.activeProfile.v1");
      const sessionStore = window.localStorage.getItem("playarr.profileSessions.v4");
      let markerPresent = false;
      let sessionsArray = false;
      try { markerPresent = JSON.parse(activeProfile || "null") !== null; } catch {}
      try { sessionsArray = Array.isArray(JSON.parse(sessionStore || "null")); } catch {}

      const options = document.querySelector(".device-login-options");
      const verificationText = document.querySelector(".device-login-url")?.textContent?.trim();
      const userCode = document.querySelector(".device-login-code")?.textContent?.trim();
      const busy = options?.getAttribute("aria-busy") === "true";
      const codeFormatValid = !!userCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode);
      let verificationUriAllowed = false;
      try {
        const verificationUri = new URL(verificationText);
        verificationUriAllowed = verificationUri.origin === "https://playarr.app" && verificationUri.pathname === "/link";
      } catch {}
      const loginErrorPresent = !!document.querySelector(".device-login-error");
      const state = { markerPresent, sessionsArray, loginOptionsPresent: !!options, busy,
        verificationUriAllowed, codeFormatValid, codeSubmitted: sent, loginErrorPresent };
      const signature = JSON.stringify(state);
      if (signature !== previousState || Date.now() - lastStateAt >= 2000) {
        previousState = signature;
        lastStateAt = Date.now();
        await fetch(`/__mirror/recovery-state?t=${encodeURIComponent(token)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: signature,
        });
      }
      if (sent || markerPresent || !options || busy || !verificationUriAllowed || !codeFormatValid) return;

      const response = await fetch(
        `/__mirror/recovery-code?t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "hosted-device-login",
            signedOut: true,
            verificationOrigin: "https://playarr.app",
            verificationPath: "/link",
            code: userCode,
          }),
        }
      );
      sent = response.ok;
    } catch {
      // Recovery metadata is deliberately silent and contains no screen content.
    }
  }

  void collectHostedCode();
  window.setInterval(() => void collectHostedCode(), 500);
})();
