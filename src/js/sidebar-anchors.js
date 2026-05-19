// Injects nested sidebar entries pointing at anchors within long lecture pages.
// mdBook's SUMMARY.md treats each entry as a unique output file, so multiple
// entries pointing at one file collide and overwrite content. Instead we
// keep one SUMMARY entry per file and patch the sidebar after page load.

(function () {
  const sections = {
    "lectures/04-correctness.html": [
      ["Problem Selection", "problem"],
      ["What an Allocator Does", "allocator-intro"],
      ["Our Allocator for This Study", "allocator-spec"],
      ["Why Concurrency is Hard", "race-walkthrough"],
      ["Why Concurrent Allocators are Interesting", "cpython-motivation"],
      ["From CSE29 Homework to Concurrent Allocator", "experiment-setup"],
      ["Doing my Homework", "r0-baseline"],
      ["Concurrency: First Steps", "r1-concurrent"],
      ["Concurrency: Asking for Speed", "r2-concurrent-pushed"],
    ],
  };

  function injectFor(suffix, entries) {
    const links = document.querySelectorAll("#sidebar a");
    let parentLi = null;
    let parentHref = null;
    for (const a of links) {
      const href = a.getAttribute("href");
      if (href && href.endsWith(suffix) && a.classList.contains("active")) {
        parentLi = a.closest("li");
        parentHref = href;
        break;
      }
    }
    if (!parentLi) return;

    const numEl = parentLi.querySelector("strong");
    const parentNum = numEl ? numEl.textContent.replace(/\.$/, "") : "";

    const wrapper = document.createElement("li");
    const ol = document.createElement("ol");
    ol.className = "section";

    entries.forEach(function (entry, idx) {
      const title = entry[0];
      const anchor = entry[1];
      const li = document.createElement("li");
      li.className = "chapter-item expanded ";
      const a = document.createElement("a");
      a.href = parentHref + "#" + anchor;
      if (parentNum) {
        const strong = document.createElement("strong");
        strong.setAttribute("aria-hidden", "true");
        strong.textContent = parentNum + "." + (idx + 1) + ".";
        a.appendChild(strong);
        a.appendChild(document.createTextNode(" " + title));
      } else {
        a.textContent = title;
      }
      li.appendChild(a);
      ol.appendChild(li);
    });

    wrapper.appendChild(ol);
    parentLi.parentNode.insertBefore(wrapper, parentLi.nextSibling);
  }

  function run() {
    for (const suffix in sections) {
      injectFor(suffix, sections[suffix]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
