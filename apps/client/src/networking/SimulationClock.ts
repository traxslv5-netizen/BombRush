// A worker clock keeps the host simulation scheduled when another tab has focus.
setInterval(() => self.postMessage('tick'), 1000 / 30);
