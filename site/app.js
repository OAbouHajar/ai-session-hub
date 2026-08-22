const installPrompt = document.querySelector("#installPrompt");
const copyButtons = [
  document.querySelector("#copyHeroPrompt"),
  document.querySelector("#copyPrompt"),
].filter(Boolean);

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const label = button.querySelector(".copy-label");
    const original = label.textContent;

    try {
      await navigator.clipboard.writeText(installPrompt.textContent.trim());
      label.textContent = "Copied";
    } catch {
      label.textContent = "Select prompt below";
      installPrompt.closest(".prompt").scrollIntoView({ behavior: "smooth" });
    }

    window.setTimeout(() => {
      label.textContent = original;
    }, 1800);
  });
});
