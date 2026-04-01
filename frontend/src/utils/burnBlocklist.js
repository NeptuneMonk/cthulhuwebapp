/**
 * Burn blocklist utility.
 * After a tether/object is burned on-chain, the p2fk.io indexer may take time to catch up.
 * This blocklist hides burned items locally until the API stops returning them.
 */

const STORAGE_KEY = (addr, net) => `cthulhu_burned_${addr}_${net}`;

export function getBurnedAddresses(myAddress, network) {
  if (!myAddress) return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY(myAddress, network))) || []);
  } catch { return new Set(); }
}

export function addBurnedAddress(myAddress, network, objectAddr) {
  if (!myAddress) return;
  const list = [...getBurnedAddresses(myAddress, network)];
  if (!list.includes(objectAddr)) {
    list.push(objectAddr);
    localStorage.setItem(STORAGE_KEY(myAddress, network), JSON.stringify(list));
  }
}

export function cleanBurnBlocklist(myAddress, network, apiAddresses) {
  if (!myAddress) return;
  const burned = getBurnedAddresses(myAddress, network);
  if (!burned.size) return;
  const remaining = [...burned].filter(b => apiAddresses.has(b));
  localStorage.setItem(STORAGE_KEY(myAddress, network), JSON.stringify(remaining));
}
