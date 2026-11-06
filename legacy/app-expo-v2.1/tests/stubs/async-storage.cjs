/* Node 테스트용 AsyncStorage 대역 (메모리) */
const m = new Map();
const api = {
  getItem: async (k) => (m.has(k) ? m.get(k) : null),
  setItem: async (k, v) => {
    m.set(k, v);
  },
  removeItem: async (k) => {
    m.delete(k);
  },
};
module.exports = api;
module.exports.default = api;
