import { Dds, loadDds } from './vendor/dds/api.js';
const solver = loadDds().then((module) => new Dds(module));
self.onmessage = async ({ data }) => {
  try {
    const dds = await solver;
    const result =
      data.type === 'table'
        ? (() => {
            const table = dds.CalcDDTablePBN({ cards: data.cards });
            return {
              tricks: table.resTable,
              par: dds.DealerPar(table, data.dealer, data.vulnerable),
            };
          })()
        : dds.SolveBoardPBN(data.deal, -1, 3, 1);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || 'Double dummy 計算失敗' });
  }
};
