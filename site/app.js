const copyButton = document.querySelector("#copyPrompt");
const prompt = document.querySelector("#installPrompt");

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(prompt.textContent);
    const label = copyButton.querySelector(".copy-label");
    label.textContent = "Copied";
    copyButton.classList.add("copied");
    window.setTimeout(() => {
      label.textContent = "Copy prompt";
      copyButton.classList.remove("copied");
    }, 1800);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(prompt);
    selection.removeAllRanges();
    selection.addRange(range);
  }
});
