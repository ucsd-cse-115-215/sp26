// Colors `chat` code blocks by speaker. Lines starting with `name>` become
// <span class="chat-line chat-<name>">…</span>; continuation lines inherit
// the previous speaker's class so wrapped paragraphs stay colored.

(function () {
  function escape(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function classify(line) {
    const prompt = line.match(/^([A-Za-z][A-Za-z0-9_-]*)>/);
    if (prompt) return "chat-" + prompt[1].toLowerCase();
    if (/^\s*\[[^\]]+\]\s*✓/.test(line)) return "chat-cite-ok";
    if (/^\s*\[[^\]]+\]\s*✗/.test(line)) return "chat-cite-bad";
    return null;
  }

  function highlight(code) {
    const lines = code.textContent.split("\n");
    let current = null;
    const out = lines.map(function (line) {
      const cls = classify(line);
      if (cls) current = cls;
      if (line.trim() === "") return "";
      if (current) {
        return '<span class="chat-line ' + current + '">' + escape(line) + "</span>";
      }
      return escape(line);
    });
    code.innerHTML = out.join("\n");
  }

  function run() {
    document.querySelectorAll("code.language-chat").forEach(highlight);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
