const copyButtons = document.querySelectorAll("#copyPrompt, #copyHeroPrompt");
const prompt = document.querySelector("#installPrompt");

copyButtons.forEach((button) => button.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(prompt.textContent);
    const label = button.querySelector(".copy-label");
    const originalLabel = label.textContent;
    label.textContent = "Copied — paste it into your AI CLI";
    button.classList.add("copied");
    window.setTimeout(() => {
      label.textContent = originalLabel;
      button.classList.remove("copied");
    }, 1800);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(prompt);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}));
