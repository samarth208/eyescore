/* Color-assist math, shared by the website preview and (as a copy in shared.js) the extension.
   Daltonize: M = I + E(I - S), with Machado, Oliveira & Fernandes (2009) simulation matrices S
   (severity 1.0, linear RGB). Strength s blends the correction: I + s*(M - I). */
(function (ES) {
  "use strict";
  const SIM = {
    protan: [
      0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
    ],
    deutan: [
      0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
    ],
    tritan: [
      1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
    ],
  };
  const ERR = {
    rg: [
      [0, 0, 0],
      [0.7, 1, 0],
      [0.7, 0, 1],
    ],
    tritan: [
      [1, 0, 0.7],
      [0, 1, 0.7],
      [0, 0, 0],
    ],
  };
  function matrix(type, strength) {
    const s = typeof strength === "number" ? Math.max(0, Math.min(1, strength)) : 1;
    const S = SIM[type],
      E = type === "tritan" ? ERR.tritan : ERR.rg;
    const D = S.map((v, i) => (i % 4 === 0 ? 1 : 0) - v);
    const M = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let k = 0; k < 3; k++) v += E[r][k] * D[k * 3 + c];
        M.push(+((r === c ? 1 : 0) + s * v).toFixed(6));
      }
    return M;
  }
  ES.dalton = { matrix };
})(window.ES);
