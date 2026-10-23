// Optional local numerical inspection; enabled only by ?verify=1.
export async function createVerification(device, field, cfg) {
    const {nx, ny, radius, reynolds, u0} = cfg;
    const size = nx * ny * 16;
    const snapshot = device.createBuffer({size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(field, 0, snapshot, 0, size); device.queue.submit([encoder.finish()]);
    await snapshot.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(snapshot.getMappedRange());
    let finite = true, rhoMin = Infinity, rhoMax = -Infinity, maxSpeed = 0;
    let wakePositive = 0, wakeNegative = 0, maxCurl = 0;
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
        const i = (y * nx + x) * 4;
        if (data[i + 3]) continue;
        finite &&= Number.isFinite(data[i]) && Number.isFinite(data[i + 1]) && Number.isFinite(data[i + 2]);
        rhoMin = Math.min(rhoMin, data[i + 2]); rhoMax = Math.max(rhoMax, data[i + 2]);
        maxSpeed = Math.max(maxSpeed, Math.hypot(data[i], data[i + 1]));
        if (x > ny * 0.58 + 4 * radius && x < nx - 4 * radius) {
            const curl = (data[i + 5] - data[i - 3] - data[i + nx * 4] + data[i - nx * 4]) * radius / u0;
            maxCurl = Math.max(maxCurl, Math.abs(curl));
            if (curl > 0.5) wakePositive++;
            if (curl < -0.5) wakeNegative++;
        }
    }
    snapshot.unmap(); snapshot.destroy();
    const probe = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const offset = (Math.floor(ny * 0.5) * nx + Math.floor(ny * 0.58 + 8 * radius)) * 16;
    const samples = [], crossings = [];
    let next = cfg.steps, pending = false, sampleStep;
    const report = {grid: [nx, ny], reynolds, diameterCells: radius * 2, u0,
        scanTime: cfg.time, finite, density: [rhoMin, rhoMax],
        maxSpeedOverInflow: maxSpeed / u0, maxMach: maxSpeed * Math.sqrt(3),
        positiveWakeCells: wakePositive, negativeWakeCells: wakeNegative, maxAbsWakeVorticity: maxCurl};
    const panel = document.createElement('pre'); panel.id = 'verification';
    panel.style.cssText = 'white-space:pre-wrap;margin:25px 36px;color:#a4c7bd;font-size:12px';
    document.body.append(panel);
    return {
        dispose() { probe.destroy(); panel.remove(); },
        sample(encoder, steps) {
            if (steps < next || pending) return;
            encoder.copyBufferToBuffer(field, offset, probe, 0, 16);
            pending = true; sampleStep = steps; next = steps + 256;
        },
        async collect() {
            if (!pending) return;
            await probe.mapAsync(GPUMapMode.READ);
            const v = new Float32Array(probe.getMappedRange())[1] / u0;
            probe.unmap(); pending = false;
            const t = cfg.time + (sampleStep - cfg.steps) * u0 / (2 * radius);
            const last = samples.at(-1);
            if (last && last.v < 0 && v >= 0) crossings.push(last.t - last.v * (t - last.t) / (v - last.v));
            samples.push({t, v});
            const periods = crossings.slice(1).map((t, i) => t - crossings[i]);
            const st = periods.length ? 1 / (periods.reduce((a, b) => a + b) / periods.length) : null;
            report.probe = {time: t, transverseVelocityOverInflow: v, cycles: periods.length, strouhal: st,
                periods, samples: samples.length};
            panel.textContent = JSON.stringify(report, null, 2);
        }
    };
}
