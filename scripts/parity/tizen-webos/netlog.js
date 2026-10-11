(function () {
  var SINK = "http://10.0.2.2:18733/";
  function send(kind, data) {
    try {
      var x = new XMLHttpRequest();
      x.__netlog = true;
      x.open("POST", SINK, true);
      x.send(JSON.stringify({ kind: kind, data: data }));
    } catch (e) {}
  }
  function redact(u) { return String(u).replace(/([?&](token|access_token|sig|signature|key)=)[^&]+/gi, "$1***"); }
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = redact(typeof input === "string" ? input : input && input.url);
    var method = (init && init.method) || (input && input.method) || "GET";
    return origFetch.apply(this, arguments).then(function (r) {
      if (!r.ok || /playback|session|stream|manifest|m3u8|mpd/.test(url)) send("fetch", { method: method, url: url, status: r.status });
      return r;
    }, function (e) { send("fetch-error", { method: method, url: url, error: String(e && e.message || e) }); throw e; });
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = redact(u); return origOpen.apply(this, arguments); };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var x = this;
    if (!x.__netlog) {
      x.addEventListener("loadend", function () { if (x.status === 0 || x.status >= 400 || /playback|session|stream/.test(x.__u)) send("xhr", { method: x.__m, url: x.__u, status: x.status }); });
    }
    return origSend.apply(this, arguments);
  };
  window.addEventListener("error", function (e) { send("error", String(e.message) + " @" + e.filename + ":" + e.lineno); });
  window.addEventListener("unhandledrejection", function (e) { send("rejection", String(e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
  var ce = console.error;
  console.error = function () { send("console.error", Array.prototype.map.call(arguments, function (a) { return String(a && a.stack || a); }).join(" ")); return ce.apply(console, arguments); };
  var cw = console.warn;
  console.warn = function () { send("console.warn", Array.prototype.map.call(arguments, function (a) { return String(a && a.stack || a); }).join(" ")); return cw.apply(console, arguments); };
  send("boot", location.href + " " + navigator.userAgent);
})();
(function () {
  window.addEventListener("keydown", function (e) {
    setTimeout(function () {
      var shell = document.querySelector(".player-shell");
      var a = document.activeElement; var info = { key: e.key, code: e.keyCode, active: a && (a.className || a.tagName), label: a && ((a.getAttribute("aria-label") || "") + " / " + (a.textContent || "").trim().slice(0, 40)), hash: location.hash };
      if (shell) {
        var chrome = shell.querySelectorAll("[class*='control'],[class*='chrome'],[class*='transport']");
        info.shellClass = shell.className;
        info.chrome = Array.prototype.slice.call(chrome, 0, 6).map(function (el) { var cs = getComputedStyle(el); return el.className + " op=" + cs.opacity + " vis=" + cs.visibility + " z=" + cs.zIndex; });
        var av = document.getElementById("av-player"); if (av) { var c = getComputedStyle(av); info.av = "z=" + c.zIndex + " vis=" + c.visibility; }
      }
      try { var x = new XMLHttpRequest(); x.__netlog = true; x.open("POST", "http://10.0.2.2:18733/", true); x.send(JSON.stringify({ kind: "key", data: info })); } catch (err) {}
    }, 700);
  }, true);
})();
(function poll() {
  // Debug-only: follow a hash route the capture tool queued on the host.
  try {
    var x = new XMLHttpRequest();
    x.__netlog = true;
    x.open("GET", "http://10.0.2.2:18733/cmd", true);
    x.onload = function () {
      var c = (x.responseText || "").trim();
      if (c.indexOf("hash:") === 0) { history.replaceState(null, "", "#" + c.slice(5)); location.reload(); }
      else if (c === "blur" && document.activeElement) document.activeElement.blur();
      else if (c.indexOf("eval:") === 0) {
        var rest = c.slice(5), sep = rest.indexOf(":"), id = rest.slice(0, sep), code = rest.slice(sep + 1);
        Promise.resolve().then(function () { return (0, eval)(code); }).then(
          function (v) { var y = new XMLHttpRequest(); y.__netlog = true; y.open("POST", "http://10.0.2.2:18733/", true); y.send(JSON.stringify({ kind: "eval", id: id, value: v })); },
          function (err) { var y = new XMLHttpRequest(); y.__netlog = true; y.open("POST", "http://10.0.2.2:18733/", true); y.send(JSON.stringify({ kind: "eval", id: id, error: String(err) })); });
      }
    };
    x.send();
  } catch (e) {}
  setTimeout(poll, 1000);
})();
