import {Flow} from './flow.js';

export async function analyticChecks(device, kernels) {
    const results = {};
    for (const mode of [1, 2]) {
        const flow = new Flow(device, kernels, 128, 64, 32); // nu = kappa = 0.1
        flow.initialize(mode);
        const encoder = device.createCommandEncoder(); flow.advance(encoder, 1000);
        device.queue.submit([encoder.finish()]); const values = await flow.readField();
        let error = 0, norm = 0, mean = 0;
        for (let y = 0; y < flow.ny; y++) for (let x = 0; x < flow.nx; x++) {
            const i = (y * flow.nx + x) * 4;
            const k = 2 * Math.PI / (mode === 1 ? flow.ny : flow.nx);
            const expected = mode === 1 ? flow.u0 * Math.exp(-flow.nu * k * k * 1000) * Math.sin(k * (y + 0.5))
                : 0.5 + 0.2 * Math.exp(-flow.nu * k * k * 1000) * Math.sin(k * (x + 0.5 - flow.u0 * 1000));
            const actual = values[i + (mode === 1 ? 0 : 3)];
            error += (actual - expected) ** 2; norm += (expected - (mode === 1 ? 0 : 0.5)) ** 2;
            mean += values[i + 2];
        }
        results[mode === 1 ? 'viscous_shear_wave' : 'scalar_advection_diffusion'] = {
            grid: [128, 64], steps: 1000, nu: flow.nu, relativeL2: Math.sqrt(error / norm), meanDensity: mean / flow.cells};
        flow.destroy();
    }
    return results;
}

export async function inspectField(flow) {
    const data = await flow.readField(); let finite = true, rhoMin = Infinity, rhoMax = -Infinity;
    let dyeMin = Infinity, dyeMax = -Infinity, meanRho = 0, meanDye = 0, kinetic = 0, crossflow = 0, maxSpeed = 0, maxCourant = 0;
    for (let i = 0; i < data.length; i += 4) {
        const u = data[i], v = data[i + 1], rho = data[i + 2], dye = data[i + 3];
        finite &&= [u, v, rho, dye].every(Number.isFinite);
        rhoMin = Math.min(rhoMin, rho); rhoMax = Math.max(rhoMax, rho);
        dyeMin = Math.min(dyeMin, dye); dyeMax = Math.max(dyeMax, dye);
        meanRho += rho; meanDye += dye; kinetic += u * u + v * v; crossflow += v * v;
        maxSpeed = Math.max(maxSpeed, Math.hypot(u, v)); maxCourant = Math.max(maxCourant, 4 * (Math.abs(u) + Math.abs(v)));
    }
    return {grid: [flow.nx, flow.ny], reynolds: flow.reynolds, time_U_over_H: flow.time, finite,
        density: [rhoMin, rhoMax], meanDensity: meanRho / flow.cells, concentration: [dyeMin, dyeMax], meanConcentration: meanDye / flow.cells,
        kineticEnergyOverU2: kinetic / (2 * flow.cells * flow.u0 ** 2), rmsTransverseOverU: Math.sqrt(crossflow / flow.cells) / flow.u0,
        maxMach: maxSpeed * Math.sqrt(3), maxAdvectiveCourant: maxCourant};
}
