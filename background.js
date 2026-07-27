chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'hbOpenPage') {
    const url = msg.page ? chrome.runtime.getURL(msg.page) : msg.url;
    if (url) chrome.tabs.create({ url });
  }
  return false;
});
